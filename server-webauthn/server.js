import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { generateAuthenticationOptions, verifyAuthenticationResponse, generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

// 簡易インメモリDB
const db = {
  users: new Map(), // username -> { currentChallenge, authenticators: [ { credentialID: Buffer, credentialPublicKey: Buffer, counter: number } ] }
  authenticators: new Map(), // base64url(credentialID) -> { username, credentialID, credentialPublicKey, counter }
};

function toB64u(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromB64u(s) {
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/') + (pad ? '='.repeat(pad) : '');
  return Buffer.from(base64, 'base64');
}

function getRPID(req) {
  return process.env.RP_ID || req.hostname;
}
function getOrigin(req) {
  return process.env.ORIGIN || `${req.protocol}://${req.get('host')}`;
}

// 登録オプション生成（Passkey作成）
app.post('/generate-registration-options', async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: 'username required' });
    const rpid = getRPID(req);
    const origin = getOrigin(req);
    const user = db.users.get(username) || { authenticators: [], currentChallenge: undefined };
    const options = await generateRegistrationOptions({
      rpID: rpid,
      rpName: process.env.RP_NAME || rpid,
      userName: username,
      userID: Buffer.from(username, 'utf8'),
      timeout: 60000,
      attestationType: 'none',
      // 既に登録済みのクレデンシャルを除外
      excludeCredentials: (user.authenticators || []).map((a) => ({ id: a.credentialID, type: 'public-key' })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      supportedAlgorithmIDs: [-7, -257],
    });
    user.currentChallenge = options.challenge;
    db.users.set(username, user);
    // Buffer を base64url に変換して返す
    const publicKey = { ...options };
    if (Array.isArray(publicKey.excludeCredentials)) {
      publicKey.excludeCredentials = publicKey.excludeCredentials.map((c) => ({ ...c, id: toB64u(Buffer.from(c.id)) }));
    }
    return res.json({ publicKey, origin });
  } catch (e) {
    return res.status(500).json({ error: 'failed to generate registration options', detail: String(e && e.message || e) });
  }
});

// 登録結果検証
app.post('/verify-registration', async (req, res) => {
  try {
    const body = req.body || {};
    const { username } = body || {};
    if (!username) return res.status(400).json({ verified: false, error: 'username required' });
    const rpid = getRPID(req);
    const origin = getOrigin(req);
    const user = db.users.get(username) || {};
    const expectedChallenge = user.currentChallenge;

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpid,
      requireUserVerification: false,
    });

    if (verification.verified) {
      const { registrationInfo } = verification;
      if (registrationInfo) {
        const { credentialID, credentialPublicKey, counter } = registrationInfo;
        const credKey = toB64u(Buffer.from(credentialID));
        const record = {
          username,
          credentialID: Buffer.from(credentialID),
          credentialPublicKey: Buffer.from(credentialPublicKey),
          counter: typeof counter === 'number' ? counter : 0,
        };
        db.authenticators.set(credKey, record);
        const u = db.users.get(username) || { authenticators: [] };
        u.authenticators = Array.isArray(u.authenticators) ? u.authenticators : [];
        u.authenticators.push(record);
        db.users.set(username, u);
      }
    }

    return res.json({ verified: verification.verified, error: verification.error || null });
  } catch (e) {
    return res.status(400).json({ verified: false, error: String(e && e.message || e) });
  }
});

// 認証オプション生成
app.post('/generate-authentication-options', async (req, res) => {
  try {
    const { username } = req.body || {};
    const rpid = getRPID(req);
    const user = db.users.get(username) || { authenticators: [], currentChallenge: undefined };
    const allowCredentials = (user.authenticators || []).map((a) => ({
      id: a.credentialID,
      type: 'public-key',
    }));
    const options = await generateAuthenticationOptions({
      timeout: 60000,
      allowCredentials,
      userVerification: 'preferred',
      rpID: rpid,
    });
    user.currentChallenge = options.challenge;
    db.users.set(username, user);
    // Buffer を base64url に変換して返す
    const publicKey = { ...options };
    if (Array.isArray(publicKey.allowCredentials)) {
      publicKey.allowCredentials = publicKey.allowCredentials.map((c) => ({ ...c, id: toB64u(Buffer.from(c.id)) }));
    }
    return res.json({ publicKey });
  } catch (e) {
    return res.status(500).json({ error: 'failed to generate options', detail: String(e && e.message || e) });
  }
});

// 認証結果検証
app.post('/verify-authentication', async (req, res) => {
  try {
    const body = req.body || {};
    const rpid = getRPID(req);
    const origin = getOrigin(req);

    const credIDb64u = body.rawId || (body.id || '');
    const credID = fromB64u(credIDb64u);
    const authr = db.authenticators.get(toB64u(credID));

    const username = (authr && authr.username) || (req.body && req.body.username) || '';
    const user = db.users.get(username) || {};
    const expectedChallenge = user.currentChallenge;

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpid,
      authenticator: authr,
    });

    if (verification.verified) {
      try {
        const { authenticationInfo } = verification;
        if (authr && authenticationInfo && typeof authenticationInfo.newCounter === 'number') {
          authr.counter = authenticationInfo.newCounter;
          db.authenticators.set(toB64u(authr.credentialID), authr);
        }
      } catch {}
    }

    return res.json({ verified: verification.verified, error: verification.error || null });
  } catch (e) {
    return res.status(400).json({ verified: false, error: String(e && e.message || e) });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`webauthn server listening on http://localhost:${port}`);
});
