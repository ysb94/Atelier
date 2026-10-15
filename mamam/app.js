const { supabaseUrl = "", supabasePublishableKey = "" } =
  window.MAMAM_CONFIG || {};
const normalizedSupabaseUrl = supabaseUrl.replace(/\/+$/, "");

function requireDatabaseConfig() {
  if (!normalizedSupabaseUrl || !supabasePublishableKey) {
    throw new Error("접수 서버 설정이 없습니다.");
  }
}

function databaseHeaders(contentType = "application/json") {
  return {
    apikey: supabasePublishableKey,
    Authorization: `Bearer ${supabasePublishableKey}`,
    "Content-Type": contentType,
  };
}

async function responseError(response, fallback) {
  try {
    const body = await response.json();
    return new Error(body.message || body.error || fallback);
  } catch {
    return new Error(fallback);
  }
}

async function callRpc(functionName, payload) {
  const response = await fetch(
    `${normalizedSupabaseUrl}/rest/v1/rpc/${functionName}`,
    {
      method: "POST",
      headers: databaseHeaders(),
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    throw await responseError(response, "접수 서버 요청에 실패했습니다.");
  }
  return response.json();
}

function dataUrlToJpegBlob(dataUrl) {
  const separator = dataUrl.indexOf(",");
  const metadata = dataUrl.slice(0, separator);
  if (separator < 0 || !/^data:image\/jpeg;base64$/i.test(metadata)) {
    throw new Error("이미지를 JPG 형식으로 변환하지 못했습니다.");
  }

  try {
    const binary = atob(dataUrl.slice(separator + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: "image/jpeg" });
  } catch {
    throw new Error("이미지를 JPG 형식으로 변환하지 못했습니다.");
  }
}

async function uploadIdeaImage(submissionId, image) {
  const blob = await dataUrlToJpegBlob(image.dataUrl);
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error("이미지는 장당 2MB 이하로 첨부해 주세요.");
  }

  const objectPath = `${submissionId}/${crypto.randomUUID()}.jpg`;
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `${normalizedSupabaseUrl}/storage/v1/object/mamam-idea-images/${encodedPath}`,
    {
      method: "POST",
      headers: {
        ...databaseHeaders("image/jpeg"),
        "x-upsert": "false",
      },
      body: blob,
    }
  );
  if (!response.ok) {
    throw await responseError(response, "이미지 업로드에 실패했습니다.");
  }
  return objectPath;
}

const IdeaRepository = {
  async submitIdea(payload) {
    requireDatabaseConfig();
    const submissionId = await callRpc("begin_mamam_idea_submission", {
      p_name: payload.name,
      p_department: payload.department,
      p_description: payload.description,
      p_website: payload.website,
    });

    const imagePaths = [];
    for (const image of payload.images) {
      imagePaths.push(await uploadIdeaImage(submissionId, image));
    }

    await callRpc("complete_mamam_idea_submission", {
      p_submission_id: submissionId,
      p_image_paths: imagePaths,
    });
    return { id: submissionId, ...payload, imagePaths };
  },
};

const PROFILE_KEY = "masmarulez_profile";
const MAX_IMAGE_COUNT = 5;
const MAX_IMAGE_DIMENSION = 1280;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const form = document.getElementById("idea-form");
const composer = document.getElementById("composer");
const pageSlot = document.getElementById("page-form-slot");
const modalSlot = document.getElementById("modal-form-slot");
const modal = document.getElementById("idea-modal");
const dialog = modal.querySelector(".modal__dialog");
const successPanel = document.getElementById("success-panel");
const successSummary = document.getElementById("success-summary");
const submitButton = document.getElementById("submit-button");
const toastEl = document.getElementById("toast");
const header = document.querySelector(".header");
const hero = document.querySelector(".hero");
const dropzone = document.getElementById("upload-dropzone");
const imageInput = document.getElementById("field-images");
const previewContainer = document.getElementById("upload-preview");

let lastTrigger = null;
let toastTimer = 0;
let saving = false;
let attachedImages = [];

function storageAvailable() {
  try {
    const key = "__mm_test";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function readProfile() {
  try {
    const data = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    if (!data || typeof data !== "object") return { name: "", department: "" };
    return {
      name: typeof data.name === "string" ? data.name : "",
      department: typeof data.department === "string" ? data.department : "",
    };
  } catch {
    return { name: "", department: "" };
  }
}

function saveProfile(name, department) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, department }));
}

function field(id) {
  return document.getElementById(id);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("파일을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    readFileAsDataUrl(file)
      .then((rawDataUrl) => {
        const img = new Image();
        img.onload = () => {
          const ratio = Math.min(
            1,
            MAX_IMAGE_DIMENSION / Math.max(img.width || 1, img.height || 1)
          );
          const width = Math.max(1, Math.round(img.width * ratio));
          const height = Math.max(1, Math.round(img.height * ratio));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("이미지를 변환할 수 없습니다."));
            return;
          }
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          resolve({ name: file.name || "image.jpg", dataUrl });
        };
        img.onerror = () => reject(new Error("이미지 형식을 확인할 수 없습니다."));
        img.src = rawDataUrl;
      })
      .catch(reject);
  });
}

function renderImagePreviews() {
  previewContainer.replaceChildren();
  if (!attachedImages.length) {
    previewContainer.hidden = true;
    return;
  }

  previewContainer.hidden = false;
  attachedImages.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "upload-thumb";

    const img = document.createElement("img");
    img.className = "upload-thumb__img";
    img.src = item.dataUrl;
    img.alt = item.name || `첨부 이미지 ${index + 1}`;

    const name = document.createElement("span");
    name.className = "upload-thumb__name";
    name.textContent = item.name || `이미지 ${index + 1}`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "upload-thumb__remove";
    removeBtn.dataset.removeImage = String(index);
    removeBtn.textContent = "삭제";

    card.append(img, name, removeBtn);
    previewContainer.append(card);
  });
}

async function handleImageFiles(fileList) {
  const files = [...(fileList || [])].filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    toast("이미지 파일(JPG, PNG, WEBP 등)만 첨부할 수 있습니다.");
    return;
  }

  const remaining = MAX_IMAGE_COUNT - attachedImages.length;
  if (remaining <= 0) {
    toast(`이미지는 최대 ${MAX_IMAGE_COUNT}장까지 첨부할 수 있습니다.`);
    return;
  }

  const targets = files.slice(0, remaining);
  if (files.length > remaining) {
    toast(`최대 ${MAX_IMAGE_COUNT}장까지만 반영되었습니다.`);
  }

  try {
    const compressed = await Promise.all(targets.map((file) => compressImageFile(file)));
    attachedImages.push(...compressed);
    renderImagePreviews();
    const imgErr = document.getElementById("error-images");
    if (imgErr) imgErr.textContent = "";
    dropzone.classList.remove("is-invalid");
  } catch {
    toast("이미지를 불러오는 중 오류가 발생했습니다.");
  } finally {
    imageInput.value = "";
  }
}

function readPayload() {
  return {
    name: field("field-name").value.trim(),
    department: field("field-department").value.trim(),
    images: attachedImages.map((img) => ({ name: img.name, dataUrl: img.dataUrl })),
    description: field("field-description").value.trim(),
    website: field("field-website")?.value.trim() || "",
  };
}

function validate(payload) {
  const errors = {};
  if (!payload.name) errors.name = "이름을 입력해 주세요.";
  if (!payload.department) errors.department = "부서를 입력해 주세요.";
  if (!payload.description) errors.description = "아이디어 설명을 입력해 주세요.";
  else if (payload.description.length < 5) errors.description = "설명은 5자 이상 적어 주세요.";
  else if (payload.description.length > 4000) errors.description = "설명은 4000자 안으로 적어 주세요.";
  return errors;
}

function clearErrors() {
  form.querySelectorAll(".is-invalid").forEach((el) => {
    el.classList.remove("is-invalid");
    el.removeAttribute("aria-invalid");
  });
  form.querySelectorAll(".field-error").forEach((el) => {
    el.textContent = "";
  });
}

function showErrors(errors) {
  const fieldIds = {
    name: "field-name",
    department: "field-department",
    images: "field-images",
    description: "field-description",
  };
  let first = null;
  Object.entries(errors).forEach(([key, message]) => {
    const input = field(fieldIds[key]);
    const error = document.getElementById(`error-${key}`);
    if (!input) return;
    if (key === "images") dropzone.classList.add("is-invalid");
    else input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    if (error) error.textContent = message;
    if (!first) first = input;
  });
  first?.focus();
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("is-visible");
  }, 2800);
}

function syncSlotNote() {
  pageSlot.classList.toggle("is-empty", !pageSlot.contains(composer));
}

function focusComposer() {
  const target = successPanel.hidden
    ? form.querySelector("input:not([type='file']), textarea")
    : document.getElementById("success-again");
  window.setTimeout(() => target?.focus(), 0);
}

function openModal(trigger) {
  if (!modal.hidden) return;
  lastTrigger = trigger || document.activeElement;
  modalSlot.append(composer);
  syncSlotNote();
  modal.hidden = false;
  document.body.classList.add("modal-open");
  focusComposer();
}

function closeModal({ restoreFocus = true } = {}) {
  if (modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  pageSlot.append(composer);
  syncSlotNote();
  if (restoreFocus) lastTrigger?.focus();
}

function trapFocus(event) {
  if (modal.hidden || event.key !== "Tab") return;
  const nodes = [...dialog.querySelectorAll("a[href], button:not([disabled]), textarea, input, select")]
    .filter((el) => !el.closest("[hidden]") && el.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function showSuccess(payload) {
  const imageText = payload.images?.length ? ` · 이미지 ${payload.images.length}장` : "";
  successSummary.textContent = `${payload.name} (${payload.department})${imageText}`;
  form.hidden = true;
  successPanel.hidden = false;
  if (!modal.hidden) dialog.scrollTo(0, 0);
  document.getElementById("success-again").focus();
}

function resetForAnother() {
  field("field-description").value = "";
  field("field-website").value = "";
  attachedImages = [];
  renderImagePreviews();
  clearErrors();
  successPanel.hidden = true;
  form.hidden = false;
  field("field-description").focus();
}

imageInput.addEventListener("change", (event) => {
  handleImageFiles(event.target.files);
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("is-dragover");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragover");
  if (event.dataTransfer?.files?.length) {
    handleImageFiles(event.dataTransfer.files);
  }
});

composer.addEventListener("paste", (event) => {
  const items = [...(event.clipboardData?.items || [])];
  const imageFiles = items
    .filter((item) => item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (imageFiles.length) {
    handleImageFiles(imageFiles);
    toast("클립보드 이미지를 첨부했습니다.");
  }
});

previewContainer.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-remove-image]");
  if (!btn) return;
  const idx = Number(btn.dataset.removeImage);
  if (!Number.isNaN(idx)) {
    attachedImages.splice(idx, 1);
    renderImagePreviews();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving) return;
  clearErrors();
  const payload = readPayload();
  const errors = validate(payload);
  if (Object.keys(errors).length) {
    showErrors(errors);
    return;
  }

  saving = true;
  submitButton.disabled = true;
  submitButton.textContent = "저장하는 중...";
  try {
    await IdeaRepository.submitIdea(payload);
    if (storageAvailable()) {
      saveProfile(payload.name, payload.department);
    }
    showSuccess(payload);
    toast("아이디어가 회사 접수함에 저장되었습니다.");
  } catch (error) {
    console.warn("[mamam] 아이디어 접수 저장 실패", {
      message: error instanceof Error ? error.message : String(error),
    });
    toast(error instanceof Error ? error.message : "접수 저장에 실패했습니다.");
  } finally {
    saving = false;
    submitButton.disabled = false;
    submitButton.textContent = "아이디어 제출하기";
  }
});

document.getElementById("success-again").addEventListener("click", resetForAnother);

document.addEventListener("click", (event) => {
  const openButton = event.target.closest("[data-open-modal]");
  if (openButton) {
    openModal(openButton);
    return;
  }
  if (event.target.closest("[data-close-modal]")) closeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
  trapFocus(event);
});

if ("IntersectionObserver" in window && hero) {
  const observer = new IntersectionObserver(
    ([entry]) => {
      header.classList.toggle("is-compact", !entry.isIntersecting);
    },
    { threshold: 0.05 }
  );
  observer.observe(hero);
}

const navLinks = [...document.querySelectorAll(".nav a[href^='#']")];
if ("IntersectionObserver" in window && navLinks.length) {
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      if (!visible) return;
      const activeHref = `#${visible.target.id}`;
      navLinks.forEach((link) => {
        link.classList.toggle("is-active", link.getAttribute("href") === activeHref);
      });
    },
    { rootMargin: "-35% 0px -55% 0px" }
  );
  navLinks.forEach((link) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (target) sectionObserver.observe(target);
  });
}

if (storageAvailable()) {
  const profile = readProfile();
  if (profile.name) field("field-name").value = profile.name;
  if (profile.department) field("field-department").value = profile.department;
}
