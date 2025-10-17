const input = document.getElementById("sample");
const saveBtn = document.getElementById("save");

async function restore() {
  const { sample = "" } = await chrome.storage.sync.get(["sample"]);
  input.value = sample;
}

async function save() {
  const sample = input.value || "";
  await chrome.storage.sync.set({ sample });
}

saveBtn.addEventListener("click", save);
restore();
