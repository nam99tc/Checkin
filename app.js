// DMPW check-in web — fires one TS-camera webhook event for the selected user.
const WEBHOOK_URL = "https://api.duallmaster.com/cameras/webhook-ts-camera";
const LS_KEY = "dmpw_checkin_user";

// Optional HTTP->MQTT bridge (Render). When set, each check-in first publishes a
// full "Face ID" device event, then fires the webhook photo ~2s later so the
// webhook attaches the image to that event. Empty => webhook only (as before).
const BRIDGE_URL = "https://dcface-bridge.onrender.com";

let USERS = [];

const $ = (id) => document.getElementById(id);

function pad(n) { return String(n).padStart(2, "0"); }

function imgPath(user, idx) {
  return `images/${user.key}/${pad(idx)}.jpg`;
}

function currentUser() {
  const key = localStorage.getItem(LS_KEY);
  return USERS.find((u) => u.key === key) || null;
}

function toast(msg, type) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + (type || "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 3500);
}

function render() {
  const user = currentUser();
  if (user) {
    $("welcome").classList.add("hidden");
    $("identity").classList.remove("hidden");
    $("userName").textContent = user.name;
    $("avatar").src = imgPath(user, 1);
  } else {
    $("identity").classList.add("hidden");
    $("welcome").classList.remove("hidden");
  }
}

function openPicker() {
  const ul = $("userList");
  ul.innerHTML = "";
  USERS.forEach((u) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<img class="u-avatar" src="${imgPath(u, 1)}" alt="" />` +
      `<span class="u-name">${u.name}</span>`;
    li.onclick = () => {
      localStorage.setItem(LS_KEY, u.key);
      $("picker").classList.add("hidden");
      render();
    };
    ul.appendChild(li);
  });
  $("picker").classList.remove("hidden");
}

// datetime-local value (YYYY-MM-DDTHH:mm) from a Date in device-local time.
function fmtLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ddMMyyyyHHmmss from the time input (past time allowed); no seconds field -> 00.
function stampFromInput() {
  const v = $("timeInput").value;
  const d = v ? new Date(v) : new Date();
  return pad(d.getDate()) + pad(d.getMonth() + 1) + d.getFullYear() +
         pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

// Open the sheet to pick an image + a check-in time before firing.
function openCheckinSheet() {
  const user = currentUser();
  if (!user) return;
  $("timeInput").value = fmtLocal(new Date());
  const grid = $("imgGrid");
  grid.innerHTML = "";
  for (let i = 1; i <= user.count; i++) {
    const path = imgPath(user, i);
    const img = document.createElement("img");
    img.src = path;
    img.alt = "";
    img.onclick = () => sendCheckin(user, path);
    grid.appendChild(img);
  }
  $("checkinSheet").classList.remove("hidden");
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// SearchScore / similarity in [0.80, 0.95] (don't hardcode). 0.87 -> "0870";
// the webhook re-derives SearchScore from this, so both steps use one value.
function randomScore() { return Math.round((0.80 + Math.random() * 0.15) * 1000) / 1000; }
function scoreToSimilarity(score) { return String(Math.round(score * 1000)).padStart(4, "0"); }

async function sendCheckin(user, path) {
  const stamp = stampFromInput();
  const whenLabel = $("timeInput").value;
  const score = randomScore();
  $("checkinSheet").classList.add("hidden");
  try {
    const blob = await fetch(path).then((r) => {
      if (!r.ok) throw new Error("Không tải được ảnh checkin");
      return r.blob();
    });

    // 1. Publish the full "Face ID" device event via the bridge, then wait so
    //    the server creates it before the webhook photo arrives to attach.
    if (BRIDGE_URL) {
      try {
        await fetch(BRIDGE_URL + "/fire-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardId: user.cardId, userName: user.name, accessTime: stamp, score: score,
          }),
        });
        await sleep(2000);
      } catch (e) {
        console.warn("bridge fire-event failed, falling back to webhook only:", e);
      }
    }

    // 2. Fire the webhook photo with the same AccessTime + score.
    // {cameraId}-{cardId}-{ddMMyyyyHHmmss}-{similarity}-2.jpg
    const fileName =
      `${user.cameraId}-${user.cardId}-${stamp}-${scoreToSimilarity(score)}-2.jpg`;
    const fd = new FormData();
    fd.append("faceImage", blob, fileName);

    // multipart POST is a CORS-safelisted request: it reaches the server even
    // though no-cors makes the response opaque (we can't read the status).
    await fetch(WEBHOOK_URL, { method: "POST", body: fd, mode: "no-cors" });

    $("avatar").src = path;
    toast("✓ Đã gửi chấm công lúc " + (whenLabel || "bây giờ"), "ok");
  } catch (e) {
    toast("✗ " + e.message, "err");
  }
}

async function init() {
  USERS = await fetch("users.json").then((r) => r.json());
  $("btnCheckin").onclick = openCheckinSheet;
  $("btnWhoami").onclick = openPicker;
  $("btnChange").onclick = () => { localStorage.removeItem(LS_KEY); render(); };
  $("pickerClose").onclick = () => $("picker").classList.add("hidden");
  $("checkinClose").onclick = () => $("checkinSheet").classList.add("hidden");
  render();
}

init();
