(function () {
  const contentModelLabels = {
    captioning: "Captioning",
    google_tagging: "Google Tagging",
    coco: "COCO Object Detection",
    cld_text: "Text Detection",
    image_quality: "Image Quality",
    watermark_detection: "Watermark Detection",
  };

  const state = {
    cloudName: "",
    hasCloudName: false,
    hasAnalyzeCredentials: false,
    uploadPreset: "",
    uploadResult: null,
    uploadWidget: null,
    visionTags: [],
    visionTagCandidates: [],
    visionTagSource: "",
    visionTagThreshold: 70,
    promptTagDefinitions: [],
    contentCaption: "",
  };

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindElements();
    bindEvents();
    await loadServerConfig();
    renderPromptTagDefinitions();
    updateControls();
  }

  function bindElements() {
    [
      "assetCard",
      "assetDimensions",
      "assetId",
      "assetPublicId",
      "contentButton",
      "contentModel",
      "contentResult",
      "contentState",
      "emptyState",
      "message",
      "previewImage",
      "addPromptTagButton",
      "promptTagButton",
      "promptTagCount",
      "promptTagDefinitions",
      "promptTagDescription",
      "promptTagName",
      "serverStatus",
      "tagThreshold",
      "tagThresholdValue",
      "updateCaptionButton",
      "updateTagsButton",
      "uploadWidgetButton",
      "visionButton",
      "visionResult",
      "visionState",
      "widgetMeta",
    ].forEach((id) => {
      elements[id] = document.querySelector(`#${id}`);
    });
  }

  function bindEvents() {
    elements.uploadWidgetButton.addEventListener("click", openUploadWidget);
    elements.visionButton.addEventListener("click", runVisionAnalysis);
    elements.contentButton.addEventListener("click", runContentAnalysis);
    elements.updateTagsButton.addEventListener("click", updateImageTags);
    elements.updateCaptionButton.addEventListener("click", updateCaptionContext);
    elements.tagThreshold.addEventListener("input", updateTagThreshold);
    elements.addPromptTagButton.addEventListener("click", addPromptTagDefinition);
    elements.promptTagButton.addEventListener("click", runPromptTagging);
    elements.promptTagDefinitions.addEventListener("click", handlePromptTagDefinitionClick);
  }

  async function loadServerConfig() {
    try {
      const config = await fetchJson("/api/config");
      state.cloudName = config.cloudName || "";
      state.hasCloudName = Boolean(config.hasCloudName && state.cloudName);
      state.hasAnalyzeCredentials = Boolean(config.hasAnalyzeCredentials);
      state.uploadPreset = config.uploadPreset || "";
      elements.serverStatus.textContent = getServerStatusText();
      elements.serverStatus.classList.toggle("is-warning", !state.hasCloudName || !state.hasAnalyzeCredentials);
      elements.widgetMeta.textContent = getWidgetMetaText();
    } catch (error) {
      elements.serverStatus.textContent = "Server unavailable";
      elements.serverStatus.classList.add("is-warning");
      showMessage(error.message, "error");
    }
  }

  function openUploadWidget() {
    if (!state.hasCloudName) {
      showMessage("Add CLOUDINARY_CLOUD_NAME to AAF_INTL/.env and restart the server.", "error");
      return;
    }

    if (!state.uploadPreset) {
      showMessage("Add CLOUDINARY_UPLOAD_PRESET to AAF_INTL/.env and restart the server.", "error");
      return;
    }

    if (!window.cloudinary || typeof window.cloudinary.createUploadWidget !== "function") {
      showMessage("Cloudinary Upload Widget script has not loaded yet.", "error");
      return;
    }

    const widget = getUploadWidget();
    widget.open();
  }

  function getUploadWidget() {
    if (state.uploadWidget) {
      return state.uploadWidget;
    }

    state.uploadWidget = window.cloudinary.createUploadWidget(
      {
        cloudName: state.cloudName,
        uploadPreset: state.uploadPreset,
        resourceType: "image",
        sources: ["local", "url", "camera"],
        multiple: false,
        folder: "AAF_INTL",
        showAdvancedOptions: false,
        styles: {
          palette: {
            window: "#ffffff",
            sourceBg: "#f4f6f3",
            windowBorder: "#d7ded9",
            tabIcon: "#126a68",
            menuIcons: "#315d96",
            textDark: "#17211d",
            textLight: "#ffffff",
            link: "#126a68",
            action: "#126a68",
            inactiveTabIcon: "#64706b",
            error: "#a33b31",
            inProgress: "#315d96",
            complete: "#126a68",
          },
        },
      },
      (error, result) => {
        if (error) {
          showMessage(error.message || "Upload widget error.", "error");
          return;
        }

        if (!result) {
          return;
        }

        if (result.event === "queues-start") {
          showMessage("Uploading with Cloudinary Upload Widget.", "info");
        }

        if (result.event === "success") {
          handleWidgetUploadSuccess(result.info);
        }
      },
    );

    return state.uploadWidget;
  }

  function handleWidgetUploadSuccess(info) {
    state.uploadResult = info;
    state.visionTags = [];
    state.visionTagCandidates = [];
    state.visionTagSource = "";
    state.contentCaption = "";
    elements.emptyState.hidden = true;
    elements.previewImage.src = optimizedImageUrl(info.secure_url || info.url);
    elements.previewImage.hidden = false;
    elements.widgetMeta.textContent = `${info.original_filename || info.public_id || "Uploaded image"} - ${formatBytes(info.bytes)}`;
    elements.assetCard.hidden = true;
    resetResult(elements.visionResult, elements.visionState);
    resetResult(elements.contentResult, elements.contentState);
    renderAssetDetails(info);
    showMessage("Upload complete.", "success");
    updateControls();
  }

  async function runVisionAnalysis() {
    const payload = {
      source: buildAnalysisSource(),
      prompts: [
        "Describe this image in detail.",
        "List visible objects, text, brands, colors, and scene details.",
        "Return 8 to 12 concise metadata tags with confidence scores from 0 to 100 using exactly this format: Tags: tag-one (92), tag-two (85), tag-three (74).",
      ],
    };

    await runAnalysis({
      endpoint: "ai_vision_general",
      button: elements.visionButton,
      stateElement: elements.visionState,
      resultElement: elements.visionResult,
      loadingLabel: "Running Vision AI",
      buttonLabel: "Use Cloudinary AI Vision",
      render: renderVisionResult,
    }, payload);
  }

  async function runPromptTagging() {
    if (!state.promptTagDefinitions.length) {
      showMessage("Add at least one prompt tag definition before analysis.", "error");
      return;
    }

    await runAnalysis({
      endpoint: "ai_vision_tagging",
      button: elements.promptTagButton,
      stateElement: elements.visionState,
      resultElement: elements.visionResult,
      loadingLabel: "Running AI Vision prompt tagging",
      buttonLabel: "Analyze Prompt Tags",
      render: renderPromptTaggingResult,
    }, {
      source: buildAnalysisSource(),
      tag_definitions: state.promptTagDefinitions,
    });
  }

  async function runContentAnalysis() {
    const endpoint = elements.contentModel.value;
    await runAnalysis({
      endpoint,
      button: elements.contentButton,
      stateElement: elements.contentState,
      resultElement: elements.contentResult,
      loadingLabel: "Running Content Analysis",
      buttonLabel: "Use AI Content Analysis",
      render: (data) => renderContentResult(data, endpoint),
    }, {
      source: buildAnalysisSource(),
    });
  }

  async function runAnalysis(config, payload) {
    if (!state.uploadResult) {
      showMessage("Upload a photo before analysis.", "error");
      return;
    }

    if (!state.hasAnalyzeCredentials) {
      showMessage("Add Cloudinary API credentials to AAF_INTL/.env and restart the server.", "error");
      return;
    }

    config.stateElement.textContent = "Running";
    config.resultElement.innerHTML = `<p class="muted">${escapeHtml(config.loadingLabel)}.</p>`;
    setBusy(config.button, true, config.loadingLabel);
    showMessage(config.loadingLabel, "info");

    try {
      const result = await postJson(`/api/analyze/${config.endpoint}`, payload);

      if (result.status === 202 && result.body?.data?.task_id) {
        config.stateElement.textContent = "Accepted";
        renderPendingTask(config.resultElement, result.body);
        await pollTask(result.body.data.task_id, config.stateElement, config.resultElement);
        return;
      }

      if (result.status < 200 || result.status >= 300) {
        throw new Error(result.body?.error?.message || result.body?.error || `Analysis failed with ${result.status}`);
      }

      config.stateElement.textContent = "Complete";
      config.render(result.body);
      showMessage("Analysis complete.", "success");
    } catch (error) {
      config.stateElement.textContent = "Error";
      renderError(config.resultElement, error.message);
      showMessage(error.message, "error");
    } finally {
      setBusy(config.button, false, config.buttonLabel);
    }
  }

  async function updateImageTags() {
    if (!state.uploadResult) {
      showMessage("Upload a photo before updating tags.", "error");
      return;
    }

    if (!state.visionTags.length) {
      showMessage("No Vision AI tags meet the selected confidence threshold.", "error");
      return;
    }

    setBusy(elements.updateTagsButton, true, "Updating Tags");
    showMessage("Updating Cloudinary tags.", "info");

    try {
      const result = await postJson("/api/assets/tags", {
        assetId: state.uploadResult.asset_id,
        publicId: state.uploadResult.public_id,
        resourceType: state.uploadResult.resource_type || "image",
        type: state.uploadResult.type || "upload",
        tags: state.visionTags,
      });

      if (result.status < 200 || result.status >= 300) {
        throw new Error(result.body?.error?.message || result.body?.error || `Tag update failed with ${result.status}`);
      }

      const sourceLabel = state.visionTagSource === "prompt-tagging"
        ? "prompt tagging matches"
        : `Vision AI tags above ${state.visionTagThreshold}%`;
      showMessage(`Updated ${sourceLabel}: ${state.visionTags.join(", ")}`, "success");
    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setBusy(elements.updateTagsButton, false, "Update Image Tags");
      updateControls();
    }
  }

  async function updateCaptionContext() {
    if (!state.uploadResult) {
      showMessage("Upload a photo before updating caption metadata.", "error");
      return;
    }

    if (!state.contentCaption) {
      showMessage("Run AI Content Analysis with Captioning first.", "error");
      return;
    }

    setBusy(elements.updateCaptionButton, true, "Adding Caption");
    showMessage("Updating Cloudinary caption and alt text.", "info");

    try {
      const result = await postJson("/api/assets/context", {
        assetId: state.uploadResult.asset_id,
        publicId: state.uploadResult.public_id,
        resourceType: state.uploadResult.resource_type || "image",
        type: state.uploadResult.type || "upload",
        caption: state.contentCaption,
      });

      if (result.status < 200 || result.status >= 300) {
        throw new Error(result.body?.error?.message || result.body?.error || `Caption update failed with ${result.status}`);
      }

      showMessage("Added caption and alt text to contextual metadata.", "success");
    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setBusy(elements.updateCaptionButton, false, "Add Caption + Alt Text");
      updateControls();
    }
  }

  async function pollTask(taskId, stateElement, resultElement) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await wait(1500);
      const result = await fetchJson(`/api/tasks/${encodeURIComponent(taskId)}`);
      const status = result?.data?.status || "pending";
      stateElement.textContent = status;

      if (status === "completed" || status === "failed") {
        resultElement.append(createRawJson(result));
        showMessage(`Async task ${status}.`, status === "completed" ? "success" : "error");
        return;
      }
    }

    stateElement.textContent = "Processing";
    showMessage("Async analysis is still processing.", "info");
  }

  function buildAnalysisSource() {
    const upload = state.uploadResult || {};
    const uri = upload.secure_url || upload.url || buildDeliveryUrl(upload);

    if (uri) {
      return { uri };
    }

    return { asset_id: upload.asset_id };
  }

  function buildDeliveryUrl(upload) {
    if (!upload?.public_id) {
      return "";
    }

    const resourceType = upload.resource_type || "image";
    const type = upload.type || "upload";
    const format = upload.format ? `.${upload.format}` : "";
    return `https://res.cloudinary.com/${encodeURIComponent(state.cloudName)}/${resourceType}/${type}/${upload.public_id}${format}`;
  }

  function renderAssetDetails(result) {
    elements.assetPublicId.textContent = result.public_id || "Not returned";
    elements.assetId.textContent = result.asset_id || "Not returned";
    elements.assetDimensions.textContent =
      result.width && result.height ? `${result.width} x ${result.height}` : "Not returned";
    elements.assetCard.hidden = false;
  }

  function renderVisionResult(data) {
    const responses = data?.data?.analysis?.responses || [];
    const values = responses.map((item) => item.value).filter(Boolean);
    state.visionTagCandidates = extractVisionTagCandidates(values);
    state.visionTags = selectVisionTagsByThreshold();
    state.visionTagSource = "general";

    elements.visionResult.innerHTML = values.length
      ? renderVisionSections(values)
      : `<p class="muted">No Vision AI responses returned.</p>`;
    if (state.visionTagCandidates.length) {
      elements.visionResult.insertAdjacentHTML("beforeend", renderTagChips(state.visionTagCandidates));
    }
    elements.visionResult.append(createRawJson(data));
    updateControls();
  }

  function renderPromptTaggingResult(data) {
    const matchedTags = extractPromptTagMatches(data);
    state.visionTagCandidates = matchedTags.map((name) => ({
      name,
      confidence: 100,
    }));
    state.visionTags = matchedTags;
    state.visionTagSource = "prompt-tagging";

    elements.visionResult.innerHTML = `
      <details class="vision-section" open>
        <summary>
          <span>Prompt Tagging Matches</span>
          <small>${matchedTags.length} matched</small>
        </summary>
        <div class="vision-section-body">
          ${
            matchedTags.length
              ? `<p>Matched prompt-defined tags:</p>${renderPromptMatchedTags(matchedTags)}`
              : `<p class="muted">No prompt-defined tags matched this image.</p>`
          }
        </div>
      </details>
      <details class="vision-section">
        <summary>
          <span>Prompt Tag Definitions</span>
          <small>${state.promptTagDefinitions.length} sent</small>
        </summary>
        <div class="vision-section-body">
          <div class="data-table">
            ${state.promptTagDefinitions.map(renderPromptDefinitionRow).join("")}
          </div>
        </div>
      </details>
    `;
    if (state.visionTagCandidates.length) {
      elements.visionResult.insertAdjacentHTML("beforeend", renderTagChips(state.visionTagCandidates));
    }
    elements.visionResult.append(createRawJson(data));
    updateControls();
  }

  function renderVisionSections(values) {
    const labels = [
      "Image Description",
      "Objects, Text, Brands + Scene Details",
      "Metadata Tags",
    ];

    return values
      .map((value, index) => `
        <details class="vision-section" ${index === 0 ? "open" : ""}>
          <summary>
            <span>${escapeHtml(labels[index] || `Vision Response ${index + 1}`)}</span>
            <small>Response ${index + 1}</small>
          </summary>
          <div class="vision-section-body">${formatVisionText(value)}</div>
        </details>
      `)
      .join("");
  }

  function formatVisionText(value) {
    return escapeHtml(value)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
  }

  function renderContentResult(data, endpoint) {
    const analysis = data?.data?.analysis || {};
    const label = contentModelLabels[endpoint] || endpoint;
    const rows = extractContentRows(analysis, endpoint);
    state.contentCaption = extractContentCaption(analysis, endpoint);

    elements.contentResult.innerHTML = `
      <div class="model-label">${escapeHtml(label)}</div>
      ${
        rows.length
          ? `<div class="data-table">${rows.map(renderDataRow).join("")}</div>`
          : `<p class="muted">No structured content-analysis data returned.</p>`
      }
    `;
    elements.contentResult.append(createRawJson(data));
    updateControls();
  }

  function extractContentRows(analysis, endpoint) {
    if (endpoint === "captioning") {
      const caption = analysis?.data?.caption;
      return caption ? [{ label: "Caption", value: caption }] : [];
    }

    if (endpoint === "google_tagging") {
      const labels = analysis?.label_annotations?.labels || [];
      return labels.map((item) => ({
        label: item.label,
        value: formatScore(item.score),
      }));
    }

    if (endpoint === "image_quality") {
      return [
        { label: "Quality", value: analysis.quality },
        { label: "Score", value: formatScore(analysis.score) },
        { label: "Confidence", value: formatScore(analysis.confidence) },
      ].filter((row) => row.value !== undefined && row.value !== "");
    }

    if (endpoint === "watermark_detection") {
      const detections = analysis?.detections || [];
      return detections.map((item) => ({
        label: item.name,
        value: formatScore(item.confidence),
      }));
    }

    return flattenTags(analysis?.tags).slice(0, 24);
  }

  function extractContentCaption(analysis, endpoint) {
    if (endpoint !== "captioning") {
      return "";
    }

    return String(analysis?.data?.caption || "").trim();
  }

  function updateTagThreshold() {
    state.visionTagThreshold = Number(elements.tagThreshold.value || 0);
    elements.tagThresholdValue.textContent = `${state.visionTagThreshold}%`;
    state.visionTags = state.visionTagSource === "prompt-tagging"
      ? state.visionTagCandidates.map((candidate) => candidate.name)
      : selectVisionTagsByThreshold();
    updateRenderedTagChips();
    updateControls();
  }

  function addPromptTagDefinition() {
    const name = normalizeTagName(elements.promptTagName.value);
    const description = elements.promptTagDescription.value.trim();

    if (!name || !description) {
      showMessage("Add both a tag name and tag definition.", "error");
      return;
    }

    const existingIndex = state.promptTagDefinitions.findIndex((definition) => definition.name === name);
    if (existingIndex === -1 && state.promptTagDefinitions.length >= 10) {
      showMessage("AI Vision Prompt Tagging supports up to 10 tag definitions per request.", "error");
      return;
    }

    const definition = { name, description };
    if (existingIndex >= 0) {
      state.promptTagDefinitions.splice(existingIndex, 1, definition);
      showMessage(`Updated prompt tag definition: ${name}`, "success");
    } else {
      state.promptTagDefinitions.push(definition);
      showMessage(`Added prompt tag definition: ${name}`, "success");
    }

    elements.promptTagName.value = "";
    elements.promptTagDescription.value = "";
    renderPromptTagDefinitions();
    updateControls();
  }

  function handlePromptTagDefinitionClick(event) {
    const button = event.target.closest("[data-remove-prompt-tag]");
    if (!button) {
      return;
    }

    const index = Number(button.dataset.removePromptTag);
    const removed = state.promptTagDefinitions.splice(index, 1)[0];
    renderPromptTagDefinitions();
    updateControls();
    if (removed) {
      showMessage(`Removed prompt tag definition: ${removed.name}`, "info");
    }
  }

  function renderPromptTagDefinitions() {
    elements.promptTagCount.textContent = `${state.promptTagDefinitions.length} ${
      state.promptTagDefinitions.length === 1 ? "definition" : "definitions"
    }`;

    if (!state.promptTagDefinitions.length) {
      elements.promptTagDefinitions.innerHTML = `<p class="muted">No prompt tag definitions added.</p>`;
      return;
    }

    elements.promptTagDefinitions.innerHTML = state.promptTagDefinitions
      .map((definition, index) => `
        <div class="prompt-tag-definition">
          <div>
            <strong>${escapeHtml(definition.name)}</strong>
            <span>${escapeHtml(definition.description)}</span>
          </div>
          <button type="button" aria-label="Remove ${escapeHtml(definition.name)}" data-remove-prompt-tag="${index}">
            Remove
          </button>
        </div>
      `)
      .join("");
  }

  function extractVisionTagCandidates(values) {
    const tagLine =
      values
        .slice()
        .reverse()
        .find((value) => /(^|\b)tags\s*:/i.test(value)) || values[values.length - 1] || "";
    const afterLabel = tagLine.replace(/^[\s\S]*?\btags\s*:/i, "");
    const rawCandidates = afterLabel
      .split(/[,;\n]/)
      .map(parseVisionTagCandidate);

    return normalizeTagCandidates(rawCandidates);
  }

  function parseVisionTagCandidate(value) {
    const cleanValue = String(value)
      .trim()
      .replace(/^[-*#\d.)\s]+/, "")
      .replace(/\.$/, "");
    const confidenceMatch = cleanValue.match(/(?:\(|:|\s-\s)?\s*(0?\.\d+|100|[1-9]?\d)\s*%?\)?$/);
    const rawConfidence = confidenceMatch ? Number(confidenceMatch[1]) : 100;
    const confidence = rawConfidence <= 1 ? Math.round(rawConfidence * 100) : Math.round(rawConfidence);
    const name = confidenceMatch
      ? cleanValue.slice(0, confidenceMatch.index).trim()
      : cleanValue;

    return {
      name,
      confidence: Math.max(0, Math.min(100, confidence)),
    };
  }

  function normalizeTagCandidates(candidates) {
    const seen = new Set();

    return candidates
      .map((candidate) => ({
        name: normalizeTagName(candidate.name),
        confidence: candidate.confidence,
      }))
      .filter((candidate) => candidate.name.length >= 2 && candidate.name.length <= 64)
      .filter((candidate) => {
        if (seen.has(candidate.name)) {
          return false;
        }
        seen.add(candidate.name);
        return true;
      })
      .slice(0, 20);
  }

  function extractPromptTagMatches(data) {
    const tags = data?.data?.analysis?.tags || data?.analysis?.tags || [];
    const rawTags = Array.isArray(tags) ? tags : Object.keys(tags);
    return normalizeTagCandidates(rawTags.map((item) => ({
      name: item?.name || item,
      confidence: 100,
    }))).map((candidate) => candidate.name);
  }

  function normalizeTagName(value) {
    return String(value)
      .trim()
      .toLowerCase()
      .replace(/^[#\s]+/, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 64);
  }

  function selectVisionTagsByThreshold() {
    return state.visionTagCandidates
      .filter((candidate) => candidate.confidence >= state.visionTagThreshold)
      .map((candidate) => candidate.name);
  }

  function updateRenderedTagChips() {
    const currentList = elements.visionResult.querySelector(".tag-list");
    if (currentList) {
      currentList.remove();
    }

    if (!state.visionTagCandidates.length) {
      return;
    }

    const rawJson = elements.visionResult.querySelector(".raw-json");
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderTagChips(state.visionTagCandidates).trim();
    const tagList = wrapper.firstElementChild;
    if (rawJson) {
      elements.visionResult.insertBefore(tagList, rawJson);
      return;
    }
    elements.visionResult.append(tagList);
  }

  function renderTagChips(candidates) {
    return `
      <div class="tag-list" aria-label="Extracted Vision AI tags">
        ${candidates
          .map((candidate) => {
            const included = candidate.confidence >= state.visionTagThreshold;
            return `
              <span class="${included ? "is-included" : "is-excluded"}">
                ${escapeHtml(candidate.name)}
                <small>${candidate.confidence}%</small>
              </span>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderPromptMatchedTags(tags) {
    return `
      <div class="prompt-match-list">
        ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
      </div>
    `;
  }

  function renderPromptDefinitionRow(definition) {
    return renderDataRow({
      label: definition.name,
      value: definition.description,
    });
  }

  function flattenTags(tags) {
    if (!tags || typeof tags !== "object") {
      return [];
    }

    return Object.entries(tags).map(([label, value]) => ({
      label,
      value: typeof value === "number" ? formatScore(value) : summarizeValue(value),
    }));
  }

  function renderPendingTask(resultElement, data) {
    resultElement.innerHTML = `
      <p class="muted">Cloudinary accepted this analysis as an async task.</p>
      <div class="data-table">
        ${renderDataRow({ label: "Task ID", value: data.data.task_id })}
        ${renderDataRow({ label: "Status", value: data.data.status })}
      </div>
    `;
    resultElement.append(createRawJson(data));
  }

  function renderError(resultElement, message) {
    resultElement.innerHTML = `<p class="error-text">${escapeHtml(message)}</p>`;
  }

  function renderDataRow(row) {
    return `
      <div class="data-row">
        <span>${escapeHtml(row.label || "Value")}</span>
        <strong>${escapeHtml(row.value ?? "Not returned")}</strong>
      </div>
    `;
  }

  function createRawJson(data) {
    const details = document.createElement("details");
    details.className = "raw-json";
    details.innerHTML = `
      <summary>Raw JSON</summary>
      <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
    `;
    return details;
  }

  function resetResult(resultElement, stateElement) {
    stateElement.textContent = "Idle";
    resultElement.innerHTML = `<p class="muted">Results appear after analysis.</p>`;
    if (resultElement === elements.visionResult) {
      state.visionTags = [];
      state.visionTagCandidates = [];
      state.visionTagSource = "";
    }
    if (resultElement === elements.contentResult) {
      state.contentCaption = "";
    }
    updateControls();
  }

  function updateControls() {
    const hasUpload = Boolean(state.uploadResult);

    elements.uploadWidgetButton.disabled = !state.hasCloudName || !state.uploadPreset;
    elements.visionButton.disabled = !hasUpload;
    elements.contentButton.disabled = !hasUpload;
    elements.promptTagButton.disabled = !hasUpload || !state.promptTagDefinitions.length;
    elements.updateTagsButton.disabled = !hasUpload || !state.visionTags.length;
    elements.updateCaptionButton.disabled = !hasUpload || !state.contentCaption;
    elements.tagThreshold.disabled = !hasUpload;
  }

  function getServerStatusText() {
    if (!state.hasCloudName) {
      return "Add CLOUDINARY_CLOUD_NAME";
    }

    if (!state.hasAnalyzeCredentials) {
      return `Cloud ${state.cloudName}: add API credentials`;
    }

    return `Cloud ${state.cloudName} connected`;
  }

  function getWidgetMetaText() {
    if (!state.hasCloudName) {
      return "Add CLOUDINARY_CLOUD_NAME to .env";
    }

    if (!state.uploadPreset) {
      return "Add CLOUDINARY_UPLOAD_PRESET to .env";
    }

    return "Local files, URL, and camera sources";
  }

  function setBusy(button, isBusy, label) {
    button.disabled = isBusy;
    button.textContent = label;
    button.classList.toggle("is-busy", isBusy);
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || `Request failed with ${response.status}`);
    }
    return data;
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return {
      status: response.status,
      body: data,
    };
  }

  function showMessage(text, type) {
    elements.message.textContent = text;
    elements.message.className = `message is-${type}`;
  }

  function optimizedImageUrl(url) {
    if (!url || !url.includes("/image/upload/")) {
      return url;
    }
    return url.replace("/image/upload/", "/image/upload/f_auto,q_auto,c_limit,w_1400/");
  }

  function formatBytes(bytes) {
    if (!bytes) {
      return "0 B";
    }
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function formatScore(score) {
    if (typeof score !== "number") {
      return score ?? "";
    }
    return score <= 1 ? `${Math.round(score * 100)}%` : score.toFixed(2);
  }

  function summarizeValue(value) {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value !== "object") {
      return String(value);
    }
    if (typeof value.confidence === "number") {
      return formatScore(value.confidence);
    }
    if (typeof value.score === "number") {
      return formatScore(value.score);
    }
    return JSON.stringify(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }
})();
