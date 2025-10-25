const input = document.getElementById("sample");
const saveBtn = document.getElementById("save");

async function restore() {
  if (!input) return;
  const { sample = "" } = await chrome.storage.sync.get(["sample"]);
  input.value = sample;
}

async function save() {
  if (!input) return;
  const sample = input.value || "";
  await chrome.storage.sync.set({ sample });
}

if (saveBtn) saveBtn.addEventListener("click", save);
restore();
