import { app } from "../../scripts/app.js";

const NODE_CLASS = "QwenCinematicLightingWorkbenchNode";
const DEFAULT_PANEL_WIDTH = 1260;
const DEFAULT_PANEL_HEIGHT = 760;
const MIN_PANEL_WIDTH = 920;
const MIN_STAGE_WIDTH = 600;
const MIN_STAGE_HEIGHT = 500;
const STAGE_RADIUS = 12;

const AUX_LABELS = ["Fill", "Rim", "Back"];
const AUX_COLORS = ["#ffd29a", "#8fc7ff", "#ff8f8f"];
const AUX_DEFAULTS = [
  { azimuth: 45, elevation: 20, distance: 4, power: 0.25, color_temp: 5600, softbox: 0.70, beam_angle: 90 },
  { azimuth: 135, elevation: 35, distance: 4, power: 0.45, color_temp: 5600, softbox: 0.15, beam_angle: 30 },
  { azimuth: 180, elevation: 40, distance: 5, power: 0.50, color_temp: 5600, softbox: 0.15, beam_angle: 35 },
];
const GOBO_OPTIONS = ["none", "blinds", "window_frame", "lattice", "foliage", "caustics", "stained_glass"];
const LEGACY_MODIFIER_ALIASES = {
  bamboo: "foliage",
  palm_leaf: "foliage",
  geometric_shadow: "lattice",
};
const MODIFIER_LABELS = {
  none: "无修饰",
  blinds: "百叶窗影",
  window_frame: "窗框投影",
  foliage: "树叶 Breakup",
  caustics: "水纹效果投影",
  lattice: "格栅影",
  stained_glass: "彩色效果玻璃",
};
const FLUX_SAMPLERS = [
  "euler", "euler_cfg_pp", "euler_ancestral", "euler_ancestral_cfg_pp", "heun", "heunpp2",
  "exp_heun_2_x0", "exp_heun_2_x0_sde", "dpm_2", "dpm_2_ancestral", "lms",
  "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_2s_ancestral_cfg_pp",
  "dpmpp_sde", "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_cfg_pp", "dpmpp_2m_sde",
  "dpmpp_2m_sde_gpu", "dpmpp_2m_sde_heun", "dpmpp_2m_sde_heun_gpu", "dpmpp_3m_sde",
  "dpmpp_3m_sde_gpu", "ddpm", "lcm", "ipndm", "ipndm_v", "deis", "res_multistep",
  "res_multistep_cfg_pp", "res_multistep_ancestral", "res_multistep_ancestral_cfg_pp",
  "gradient_estimation", "gradient_estimation_cfg_pp", "er_sde", "seeds_2", "seeds_3",
  "sa_solver", "sa_solver_pece", "ddim", "uni_pc", "uni_pc_bh2",
];
const HIDDEN_WIDGETS = new Set([
  "user_prompt",
  "gemini_api_key",
  "sampler_name",
  "steps",
  "noise_seed",
  "cfg",
  "lighting_strength",
  "structure_lock_radius",
  "max_exposure_stops",
  "transfer_light_color",
  "world_azimuth",
  "world_elevation",
  "world_distance",
  "world_power",
  "world_softbox",
  "world_color_temp",
  "main_modifier",
  "modifier_strength",
  "modifier_softness",
  "modifier_scale",
  "modifier_rotation",
  "sky_power",
  "sky_auto_temp",
  "sky_color_temp",
  "aux_lights_json",
]);

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function normalizeAngle(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return ((Math.round(number) % 360) + 360) % 360;
}

function normalizeModifier(value) {
  const raw = String(value || "none");
  const normalized = LEGACY_MODIFIER_ALIASES[raw] || raw;
  return GOBO_OPTIONS.includes(normalized) ? normalized : "none";
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  if (value == null) return fallback;
  return Boolean(value);
}

function kelvinToRgb(kelvin) {
  const temp = clamp(kelvin, 1500, 12000) / 100;
  let red;
  let green;
  let blue;

  if (temp <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(temp) - 161.1195681661;
    blue = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    red = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    green = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    blue = 255;
  }

  const toHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function findWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function getWidgetValue(node, name, fallback) {
  const widget = findWidget(node, name);
  return widget ? widget.value : fallback;
}

function setWidgetValue(node, name, value) {
  const widget = findWidget(node, name);
  if (!widget) return;
  widget.value = value;
  if (typeof widget.callback === "function") {
    widget.callback.call(widget, value);
  }
  app.graph.setDirtyCanvas(true, true);
}

function createStorageWidget(widget) {
  const storage = {
    name: widget.name,
    type: "qwen-cine-storage",
    value: widget.value,
    options: { ...(widget.options || {}), hidden: true },
    serialize: widget.serialize,
    _qwenCineStorage: true,
    _qwenOriginalType: widget.type,
    computeSize: () => [0, -4],
    draw: () => {},
    mouse: () => false,
    onPointerDown: () => false,
    onPointerMove: () => false,
    onPointerUp: () => false,
    onClick: () => false,
    callback: () => {},
  };
  storage.serializeValue = () => storage.value;
  if (widget.inputEl) widget.inputEl.style.display = "none";
  return storage;
}

function panelWidth(width) {
  return Math.max(Number(width || DEFAULT_PANEL_WIDTH), MIN_PANEL_WIDTH);
}

function applyPanelSize(root, width) {
  if (!root) return;
  root.style.width = `${panelWidth(width)}px`;
  root.style.height = `${DEFAULT_PANEL_HEIGHT}px`;
}

function parseAuxLights(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, AUX_LABELS.length).map((light, index) => normalizeAuxLight(light, index));
  } catch {
    return [];
  }
}

function normalizeAuxLight(light, index) {
  const data = light && typeof light === "object" ? light : {};
  const defaults = AUX_DEFAULTS[index] || AUX_DEFAULTS[0];
  return {
    enabled: parseBoolean(data.enabled),
    label: String(data.label || AUX_LABELS[index] || `Aux ${index + 1}`),
    azimuth: normalizeAngle(data.azimuth ?? defaults.azimuth),
    elevation: clamp(data.elevation ?? defaults.elevation, -20, 90),
    distance: clamp(data.distance ?? defaults.distance, 0.5, 20),
    power: clamp(data.power ?? defaults.power, 0, 1),
    color_temp: Math.round(clamp(data.color_temp ?? defaults.color_temp, 1500, 12000)),
    softbox: clamp(data.softbox ?? defaults.softbox, 0, 1),
    beam_angle: clamp(data.beam_angle ?? defaults.beam_angle, 5, 120),
  };
}

function serializeAuxLights(lights) {
  const normalized = Array.from({ length: AUX_LABELS.length }, (_, index) => normalizeAuxLight(lights[index], index));
  return JSON.stringify(normalized, null, 2);
}

function createButton(label, onClick, title = "") {
  const button = document.createElement("button");
  button.textContent = label;
  button.title = title;
  button.type = "button";
  button.className = "qwen-cine-button";
  button.addEventListener("click", onClick);
  return button;
}

function createRange(label, min, max, step, getValue, setValue, suffix = "") {
  const wrap = document.createElement("label");
  wrap.className = "qwen-cine-range";
  const top = document.createElement("span");
  top.className = "qwen-cine-range-top";
  const caption = document.createElement("span");
  caption.textContent = label;
  const valueText = document.createElement("strong");
  top.append(caption, valueText);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  const sync = () => {
    input.value = String(getValue());
    valueText.textContent = `${input.value}${suffix}`;
  };
  input.addEventListener("input", () => {
    const value = Number(input.value);
    valueText.textContent = `${input.value}${suffix}`;
    setValue(value);
  });
  wrap.append(top, input);
  wrap._sync = sync;
  wrap._setEnabled = (enabled) => {
    input.disabled = !enabled;
    wrap.dataset.disabled = enabled ? "false" : "true";
  };
  sync();
  return wrap;
}

function createSelect(label, options, getValue, setValue, labelMap = {}) {
  const wrap = document.createElement("label");
  wrap.className = "qwen-cine-select";
  const caption = document.createElement("span");
  caption.textContent = label;
  const select = document.createElement("select");
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option;
    el.textContent = labelMap[option] || option;
    select.appendChild(el);
  }
  const sync = () => {
    select.value = String(getValue());
  };
  select.addEventListener("change", () => setValue(select.value));
  wrap.append(caption, select);
  wrap._sync = sync;
  sync();
  return wrap;
}

function createTextarea(label, getValue, setValue, placeholder = "") {
  const wrap = document.createElement("label");
  wrap.className = "qwen-cine-textarea";
  const caption = document.createElement("span");
  caption.textContent = label;
  const textarea = document.createElement("textarea");
  textarea.placeholder = placeholder;
  const sync = () => {
    if (document.activeElement !== textarea) textarea.value = String(getValue() ?? "");
  };
  textarea.addEventListener("change", () => setValue(textarea.value));
  textarea.addEventListener("blur", () => setValue(textarea.value));
  wrap.append(caption, textarea);
  wrap._sync = sync;
  sync();
  return wrap;
}

function createSecretInput(label, getValue, setValue, placeholder = "") {
  const wrap = document.createElement("label");
  wrap.className = "qwen-cine-secret";
  const caption = document.createElement("span");
  caption.textContent = label;
  const input = document.createElement("input");
  input.type = "password";
  input.autocomplete = "new-password";
  input.spellcheck = false;
  input.placeholder = placeholder;
  const sync = () => {
    if (document.activeElement !== input) input.value = String(getValue() ?? "");
  };
  input.addEventListener("change", () => setValue(input.value));
  input.addEventListener("blur", () => setValue(input.value));
  wrap.append(caption, input);
  wrap._sync = sync;
  sync();
  return wrap;
}

function createTextInput(label, getValue, setValue, placeholder = "") {
  const wrap = document.createElement("label");
  wrap.className = "qwen-cine-secret";
  const caption = document.createElement("span");
  caption.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.spellcheck = false;
  input.placeholder = placeholder;
  const sync = () => {
    if (document.activeElement !== input) input.value = String(getValue() ?? "");
  };
  input.addEventListener("change", () => setValue(input.value));
  input.addEventListener("blur", () => setValue(input.value));
  wrap.append(caption, input);
  wrap._sync = sync;
  sync();
  return wrap;
}

function createToggle(label, getValue, setValue) {
  const button = createButton("", () => {
    setValue(!getValue());
  });
  button.classList.add("qwen-cine-toggle");
  const sync = () => {
    const enabled = Boolean(getValue());
    button.textContent = `${label}: ${enabled ? "开" : "关"}`;
    button.dataset.enabled = enabled ? "true" : "false";
  };
  button._sync = sync;
  sync();
  return button;
}

function resetNodeToDefaultSize(node) {
  if (!node) return;
  const width = DEFAULT_PANEL_WIDTH + 36;
  const height = DEFAULT_PANEL_HEIGHT + 82;
  if (typeof node.setSize === "function") {
    node.setSize([width, height]);
  } else {
    node.size = [width, height];
  }
  node._qwenCineStageWidget?.computeSize?.(DEFAULT_PANEL_WIDTH);
  node._qwenCineStage?.resize();
  node._qwenCineStage?.sync();
  app.graph.setDirtyCanvas(true, true);
}

class VirtualLightingStage {
  constructor(node, root) {
    this.node = node;
    this.root = root;
    this.canvas = root.querySelector("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.info = root.querySelector("[data-role='stage-info']");
    this.auxList = root.querySelector("[data-role='aux-list']");
    this.dragTarget = null;
    this.selectedAuxIndex = 0;
    this.syncControls = [];
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.hideNativeLightingWidgets();
    this.migrateLegacyModifier();
    this.buildControls();
    this.bindCanvas();
    this.wrapWidgetCallbacks();
    this.resize();
    this.render();
    for (const delay of [50, 250, 800]) {
      setTimeout(() => {
        this.resize();
        this.sync();
      }, delay);
    }
  }

  get state() {
    const aux = parseAuxLights(getWidgetValue(this.node, "aux_lights_json", "[]"));
    return {
      userPrompt: String(getWidgetValue(this.node, "user_prompt", "")),
      geminiApiKey: String(getWidgetValue(this.node, "gemini_api_key", "")),
      samplerName: String(getWidgetValue(this.node, "sampler_name", "euler")),
      steps: Math.round(clamp(getWidgetValue(this.node, "steps", 4), 1, 100)),
      noiseSeed: String(getWidgetValue(this.node, "noise_seed", 0)),
      cfg: clamp(getWidgetValue(this.node, "cfg", 1), 0, 100),
      lightingStrength: clamp(getWidgetValue(this.node, "lighting_strength", 1), 0, 1),
      lockRadius: Math.round(clamp(getWidgetValue(this.node, "structure_lock_radius", 64), 4, 256)),
      maxExposureStops: clamp(getWidgetValue(this.node, "max_exposure_stops", 1.25), 0.1, 4),
      transferLightColor: parseBoolean(getWidgetValue(this.node, "transfer_light_color", false), false),
      mainModifier: normalizeModifier(getWidgetValue(this.node, "main_modifier", "none")),
      modifierStrength: clamp(getWidgetValue(this.node, "modifier_strength", 0), 0, 1),
      modifierSoftness: clamp(getWidgetValue(this.node, "modifier_softness", 0.35), 0, 1),
      modifierScale: clamp(getWidgetValue(this.node, "modifier_scale", 1), 0.05, 5),
      modifierRotation: clamp(getWidgetValue(this.node, "modifier_rotation", 0), -180, 180),
      azimuth: normalizeAngle(getWidgetValue(this.node, "world_azimuth", 315)),
      elevation: clamp(getWidgetValue(this.node, "world_elevation", 35), -20, 90),
      distance: clamp(getWidgetValue(this.node, "world_distance", 10), 0.5, 50),
      power: clamp(getWidgetValue(this.node, "world_power", 1), 0, 5),
      softbox: clamp(getWidgetValue(this.node, "world_softbox", 0), 0, 1),
      kelvin: Math.round(clamp(getWidgetValue(this.node, "world_color_temp", 5600), 1500, 12000)),
      skyPower: clamp(getWidgetValue(this.node, "sky_power", 0.3), 0, 1),
      skyAutoTemp: parseBoolean(getWidgetValue(this.node, "sky_auto_temp", true), true),
      skyTemp: Math.round(clamp(getWidgetValue(this.node, "sky_color_temp", 6500), 1500, 12000)),
      aux,
    };
  }

  hideNativeLightingWidgets() {
    const widgets = this.node.widgets || [];
    for (let index = 0; index < widgets.length; index += 1) {
      const widget = widgets[index];
      if (!HIDDEN_WIDGETS.has(widget.name) || widget._qwenCineStorage) continue;
      widgets[index] = createStorageWidget(widget);
    }
  }

  migrateLegacyModifier() {
    const current = String(getWidgetValue(this.node, "main_modifier", "none"));
    const replacement = LEGACY_MODIFIER_ALIASES[current];
    if (replacement) setWidgetValue(this.node, "main_modifier", replacement);
  }

  buildControls() {
    const statusPanel = this.root.querySelector("[data-role='status-panel']");
    const fluxLockPanel = this.root.querySelector("[data-role='flux-lock-panel']");
    const promptPanel = this.root.querySelector("[data-role='prompt-panel']");
    const presetPanel = this.root.querySelector("[data-role='preset-panel']");
    const controlPanel = this.root.querySelector("[data-role='control-panel']");
    const modifierPanel = this.root.querySelector("[data-role='modifier-panel']");
    const auxDetailPanel = this.root.querySelector("[data-role='aux-detail-panel']");

    statusPanel.appendChild(createButton("恢复推荐尺寸", () => resetNodeToDefaultSize(this.node), "恢复推荐横向工作台尺寸"));
    const lockStatus = document.createElement("p");
    lockStatus.className = "qwen-cine-note";
    lockStatus.textContent = "单节点流程：Gemini 分析 -> Flux 打光 -> 原图结构锁定输出。";
    statusPanel.appendChild(lockStatus);

    const promptControls = [
      createSecretInput("Gemini API Key", () => this.state.geminiApiKey, (value) => {
        setWidgetValue(this.node, "gemini_api_key", value.trim());
      }, "Paste API key (stored in workflow)"),
      createTextarea("光影目标", () => this.state.userPrompt, (value) => {
        setWidgetValue(this.node, "user_prompt", value);
        this.sync();
      }, "可选：描述希望强化的光影氛围；Gemini 将分析原图后制定打光策略。"),
    ];
    for (const control of promptControls) {
      this.syncControls.push(control);
      promptPanel.appendChild(control);
    }

    const fluxLockControls = [
      createSelect("Flux 采样器", FLUX_SAMPLERS, () => this.state.samplerName, (value) => {
        setWidgetValue(this.node, "sampler_name", value);
      }),
      createRange("采样步数", 1, 100, 1, () => this.state.steps, (value) => {
        setWidgetValue(this.node, "steps", Math.round(value));
      }),
      createRange("CFG", 0, 10, 0.1, () => this.state.cfg, (value) => {
        setWidgetValue(this.node, "cfg", value);
      }),
      createTextInput("随机种子", () => this.state.noiseSeed, (value) => {
        const parsed = Number(value);
        setWidgetValue(this.node, "noise_seed", Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0);
      }, "0"),
      createRange("光照转移强度", 0, 1, 0.01, () => this.state.lightingStrength, (value) => {
        setWidgetValue(this.node, "lighting_strength", value);
      }),
      createRange("结构锁定半径", 4, 256, 1, () => this.state.lockRadius, (value) => {
        setWidgetValue(this.node, "structure_lock_radius", Math.round(value));
      }),
      createRange("最大曝光改变", 0.1, 4, 0.05, () => this.state.maxExposureStops, (value) => {
        setWidgetValue(this.node, "max_exposure_stops", value);
      }, " stops"),
      createToggle("转移低频色光", () => this.state.transferLightColor, (value) => {
        setWidgetValue(this.node, "transfer_light_color", value);
      }),
    ];
    for (const control of fluxLockControls) {
      this.syncControls.push(control);
      fluxLockPanel.appendChild(control);
    }
    const lockNote = document.createElement("p");
    lockNote.className = "qwen-cine-note";
    lockNote.textContent = "输出始终以原图细节为底板；锁定半径越高，越不接受 Flux 的细纹理变化。";
    fluxLockPanel.appendChild(lockNote);

    const presets = [
      ["正面柔光", { azimuth: 0, elevation: 25, distance: 6, power: 0.8, softbox: 0.85 }],
      ["45度主光", { azimuth: 315, elevation: 35, distance: 6, power: 1.2, softbox: 0.55 }],
      ["伦勃朗参考", { azimuth: 315, elevation: 45, distance: 5, power: 1.4, softbox: 0.35 }],
      ["右侧分割", { azimuth: 90, elevation: 28, distance: 5, power: 1.35, softbox: 0.18 }],
      ["左侧分割", { azimuth: 270, elevation: 28, distance: 5, power: 1.35, softbox: 0.18 }],
      ["逆光轮廓", { azimuth: 180, elevation: 40, distance: 7, power: 1.6, softbox: 0.28 }],
      ["高位顶光", { azimuth: 0, elevation: 82, distance: 3, power: 1.1, softbox: 0.15 }],
      ["低位上照", { azimuth: 0, elevation: -14, distance: 2.5, power: 1.0, softbox: 0.05 }],
    ];

    for (const [label, values] of presets) {
      presetPanel.appendChild(createButton(label, () => {
        setWidgetValue(this.node, "world_azimuth", values.azimuth);
        setWidgetValue(this.node, "world_elevation", values.elevation);
        setWidgetValue(this.node, "world_distance", values.distance);
        setWidgetValue(this.node, "world_power", values.power);
        setWidgetValue(this.node, "world_softbox", values.softbox);
        this.sync();
      }));
    }

    const manualSkyTempControl = createRange("手动填充色温", 1500, 12000, 50, () => this.state.skyTemp, (v) => {
      setWidgetValue(this.node, "sky_color_temp", Math.round(v));
      this.render();
    }, "K");
    const syncManualSkyTemp = manualSkyTempControl._sync;
    manualSkyTempControl._sync = () => {
      syncManualSkyTemp();
      manualSkyTempControl._setEnabled(!this.state.skyAutoTemp);
    };
    manualSkyTempControl._sync();

    this.syncControls.push(
      createRange("水平角", 0, 360, 1, () => this.state.azimuth, (v) => {
        setWidgetValue(this.node, "world_azimuth", normalizeAngle(v));
        this.render();
      }, "°"),
      createRange("高度/俯仰", -20, 90, 1, () => this.state.elevation, (v) => {
        setWidgetValue(this.node, "world_elevation", v);
        this.render();
      }, "°"),
      createRange("灯距", 0.5, 50, 0.5, () => this.state.distance, (v) => {
        setWidgetValue(this.node, "world_distance", v);
        this.render();
      }, "m"),
      createRange("强度", 0, 5, 0.05, () => this.state.power, (v) => {
        setWidgetValue(this.node, "world_power", v);
        this.render();
      }),
      createRange("柔光面积", 0, 1, 0.01, () => this.state.softbox, (v) => {
        setWidgetValue(this.node, "world_softbox", v);
        this.render();
      }),
      createRange("色温", 1500, 12000, 50, () => this.state.kelvin, (v) => {
        setWidgetValue(this.node, "world_color_temp", Math.round(v));
        this.render();
      }, "K"),
      createRange("环境漫射/天光补光", 0, 1, 0.01, () => this.state.skyPower, (v) => {
        setWidgetValue(this.node, "sky_power", v);
        this.render();
      }),
      createToggle("自然天光色温估算", () => this.state.skyAutoTemp, (value) => {
        setWidgetValue(this.node, "sky_auto_temp", value);
        this.sync();
      }),
      manualSkyTempControl,
    );

    for (const control of this.syncControls) controlPanel.appendChild(control);
    const skyNote = document.createElement("p");
    skyNote.className = "qwen-cine-note";
    skyNote.textContent = "环境漫射模拟天空散射光与场景反射补光：抬起暗部，不产生新硬阴影；关闭估算后可手动设色温。";
    controlPanel.appendChild(skyNote);

    const modifierControls = [
      createSelect("投影附件", GOBO_OPTIONS, () => this.state.mainModifier, (value) => {
        setWidgetValue(this.node, "main_modifier", value);
        if (value === "none") setWidgetValue(this.node, "modifier_strength", 0);
        else if (this.state.modifierStrength <= 0.001) setWidgetValue(this.node, "modifier_strength", 0.65);
        this.sync();
      }, MODIFIER_LABELS),
      createRange("修饰强度", 0, 1, 0.01, () => this.state.modifierStrength, (v) => {
        setWidgetValue(this.node, "modifier_strength", v);
        this.render();
      }),
      createRange("投影柔度", 0, 1, 0.01, () => this.state.modifierSoftness, (v) => {
        setWidgetValue(this.node, "modifier_softness", v);
        this.render();
      }),
      createRange("图案比例", 0.05, 5, 0.05, () => this.state.modifierScale, (v) => {
        setWidgetValue(this.node, "modifier_scale", v);
        this.render();
      }),
      createRange("图案旋转", -180, 180, 1, () => this.state.modifierRotation, (v) => {
        setWidgetValue(this.node, "modifier_rotation", v);
        this.render();
      }, "°"),
    ];
    for (const control of modifierControls.slice(1)) {
      const syncModifierControl = control._sync;
      control._sync = () => {
        syncModifierControl();
        control._setEnabled(this.state.mainModifier !== "none");
      };
      control._sync();
    }
    for (const control of modifierControls) {
      this.syncControls.push(control);
      modifierPanel.appendChild(control);
    }
    const modifierNote = document.createElement("p");
    modifierNote.className = "qwen-cine-note";
    modifierNote.textContent = "真实等效：金属遮片、breakup gobo 或效果玻璃；水纹/彩色只改变照明，不新增物体。";
    modifierPanel.appendChild(modifierNote);

    const auxControls = [
      createRange("辅助水平角", 0, 360, 1, () => this.selectedAux.azimuth, (v) => this.updateSelectedAux({ azimuth: normalizeAngle(v) }), "°"),
      createRange("辅助高度", -20, 90, 1, () => this.selectedAux.elevation, (v) => this.updateSelectedAux({ elevation: v }), "°"),
      createRange("辅助灯距", 0.5, 20, 0.5, () => this.selectedAux.distance, (v) => this.updateSelectedAux({ distance: v }), "m"),
      createRange("辅助强度", 0, 1, 0.01, () => this.selectedAux.power, (v) => this.updateSelectedAux({ power: v })),
      createRange("辅助柔光", 0, 1, 0.01, () => this.selectedAux.softbox, (v) => this.updateSelectedAux({ softbox: v })),
      createRange("辅助色温", 1500, 12000, 50, () => this.selectedAux.color_temp, (v) => this.updateSelectedAux({ color_temp: Math.round(v) }), "K"),
      createRange("光束角", 5, 120, 1, () => this.selectedAux.beam_angle, (v) => this.updateSelectedAux({ beam_angle: v }), "°"),
    ];
    for (const control of auxControls) {
      this.syncControls.push(control);
      auxDetailPanel.appendChild(control);
    }
  }

  get selectedAux() {
    const aux = parseAuxLights(getWidgetValue(this.node, "aux_lights_json", "[]"));
    return normalizeAuxLight(aux[this.selectedAuxIndex], this.selectedAuxIndex);
  }

  updateSelectedAux(patch) {
    const aux = parseAuxLights(getWidgetValue(this.node, "aux_lights_json", "[]"));
    const current = normalizeAuxLight(aux[this.selectedAuxIndex], this.selectedAuxIndex);
    aux[this.selectedAuxIndex] = {
      ...current,
      ...patch,
      enabled: true,
      label: current.label || AUX_LABELS[this.selectedAuxIndex],
    };
    setWidgetValue(this.node, "aux_lights_json", serializeAuxLights(aux));
    this.sync();
  }

  setAuxFromPoint(index, point) {
    this.selectedAuxIndex = index;
    const aux = parseAuxLights(getWidgetValue(this.node, "aux_lights_json", "[]"));
    const current = normalizeAuxLight(aux[index], index);
    const azimuth = normalizeAngle((Math.atan2(point.x, -point.z) * 180) / Math.PI);
    const distance = clamp(Math.sqrt(point.x * point.x + point.z * point.z), 0.5, 20);
    aux[index] = { ...current, enabled: true, azimuth, distance };
    setWidgetValue(this.node, "aux_lights_json", serializeAuxLights(aux));
    this.sync();
  }

  wrapWidgetCallbacks() {
    for (const widget of this.node.widgets || []) {
      if (widget._qwenStageWrapped) continue;
      const original = widget.callback;
      widget.callback = (...args) => {
        const result = typeof original === "function" ? original.apply(widget, args) : undefined;
        requestAnimationFrame(() => this.sync());
        return result;
      };
      widget._qwenStageWrapped = true;
    }
  }

  bindCanvas() {
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.render();
    });
    this.resizeObserver.observe(this.canvas.parentElement);

    this.canvas.addEventListener("pointerdown", (event) => {
      const hit = this.hitTest(event);
      if (!hit) return;
      this.dragTarget = hit;
      this.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragTarget) {
        this.canvas.style.cursor = this.hitTest(event) ? "grab" : "crosshair";
        return;
      }
      const point = this.pointerToStage(event);
      if (!point) return;
      if (this.dragTarget.type === "world") {
        const azimuth = normalizeAngle((Math.atan2(point.x, -point.z) * 180) / Math.PI);
        const distance = clamp(Math.sqrt(point.x * point.x + point.z * point.z), 0.5, 50);
        setWidgetValue(this.node, "world_azimuth", azimuth);
        setWidgetValue(this.node, "world_distance", Math.round(distance * 10) / 10);
      } else if (this.dragTarget.type === "aux") {
        this.selectedAuxIndex = this.dragTarget.index;
        this.setAuxFromPoint(this.dragTarget.index, point);
      }
      this.sync();
      event.preventDefault();
    });

    this.canvas.addEventListener("pointerup", (event) => {
      this.dragTarget = null;
      try {
        this.canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Some browsers release the pointer implicitly.
      }
      this.render();
    });

    this.canvas.addEventListener("dblclick", (event) => {
      const hit = this.hitTest(event);
      if (hit?.type === "aux") {
        const aux = parseAuxLights(getWidgetValue(this.node, "aux_lights_json", "[]"));
        aux[hit.index] = { ...normalizeAuxLight(aux[hit.index], hit.index), enabled: false };
        setWidgetValue(this.node, "aux_lights_json", serializeAuxLights(aux));
        this.sync();
      }
    });
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const rootRect = this.root.getBoundingClientRect();
    const fallbackWidth = Math.max(MIN_STAGE_WIDTH, Math.floor((rootRect.width || DEFAULT_PANEL_WIDTH) - 340));
    const fallbackHeight = Math.max(MIN_STAGE_HEIGHT, DEFAULT_PANEL_HEIGHT - 190);
    const width = Math.max(MIN_STAGE_WIDTH, Math.floor(rect.width || fallbackWidth));
    const height = Math.max(MIN_STAGE_HEIGHT, Math.floor(rect.height || fallbackHeight));
    this.canvas.width = Math.floor(width * this.pixelRatio);
    this.canvas.height = Math.floor(height * this.pixelRatio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
  }

  sync() {
    this.hideNativeLightingWidgets();
    for (const control of this.syncControls) control._sync?.();
    this.renderAuxList();
    this.render();
  }

  stageScale() {
    const width = this.canvas.clientWidth || 820;
    const height = this.canvas.clientHeight || 500;
    return Math.min(width * 0.038, height * 0.073, 30);
  }

  project(x, z, height = 0) {
    const width = this.canvas.clientWidth;
    const heightPx = this.canvas.clientHeight;
    const scale = this.stageScale();
    const cx = width * 0.52;
    const cy = heightPx * 0.62;
    return {
      x: cx + x * scale,
      y: cy + z * scale * 0.42 - height * scale * 0.88,
    };
  }

  lightPosition(azimuth, elevation, distance) {
    const az = (normalizeAngle(azimuth) * Math.PI) / 180;
    const dist = clamp(distance, 0.5, 50) / STAGE_RADIUS;
    const groundDistance = clamp(dist, 0.08, 1.05) * STAGE_RADIUS;
    return {
      x: Math.sin(az) * groundDistance,
      z: -Math.cos(az) * groundDistance,
      y: 1.4 + Math.sin((clamp(elevation, -20, 90) * Math.PI) / 180) * 5.4,
    };
  }

  pointerToStage(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const scale = this.stageScale();
    const cx = width * 0.52;
    const cy = height * 0.62;
    const stageX = (x - cx) / scale;
    const stageZ = (y - cy) / (scale * 0.42);
    const radius = Math.sqrt(stageX * stageX + stageZ * stageZ);
    if (radius > STAGE_RADIUS) {
      return {
        x: (stageX / radius) * STAGE_RADIUS,
        z: (stageZ / radius) * STAGE_RADIUS,
      };
    }
    return { x: stageX, z: stageZ };
  }

  hitTest(event) {
    const pointer = this.getPointer(event);
    const state = this.state;
    const world = this.lightPosition(state.azimuth, state.elevation, state.distance);
    const worldPoint = this.project(world.x, world.z, world.y);
    if (distance(pointer, worldPoint) < 24) return { type: "world" };

    for (let index = 0; index < state.aux.length; index++) {
      const aux = state.aux[index];
      if (!aux.enabled) continue;
      const pos = this.lightPosition(aux.azimuth, aux.elevation, aux.distance);
      const p = this.project(pos.x, pos.z, pos.y);
      if (distance(pointer, p) < 18) return { type: "aux", index };
    }
    return null;
  }

  getPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  render() {
    const ctx = this.ctx;
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.width / this.pixelRatio || MIN_STAGE_WIDTH);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.height / this.pixelRatio || MIN_STAGE_HEIGHT);
    if (width < 2 || height < 2) {
      requestAnimationFrame(() => {
        this.resize();
        this.render();
      });
      return;
    }
    const state = this.state;
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#090911");
    gradient.addColorStop(0.62, "#11111e");
    gradient.addColorStop(1, "#07070b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    this.drawGrid(ctx, width, height);
    this.drawViewReference(ctx);
    this.drawSubject(ctx);
    this.drawWorldLight(ctx, state);
    this.drawMainModifier(ctx, state);
    for (let i = 0; i < state.aux.length; i++) this.drawAuxLight(ctx, state.aux[i], i);
    this.drawOverlay(ctx, state);
  }

  drawGrid(ctx, width, height) {
    const center = this.project(0, 0, 0);
    ctx.save();
    ctx.strokeStyle = "rgba(100, 120, 160, 0.17)";
    ctx.lineWidth = 1;
    for (let i = -STAGE_RADIUS; i <= STAGE_RADIUS; i += 2) {
      const a = this.project(i, -STAGE_RADIUS, 0);
      const b = this.project(i, STAGE_RADIUS, 0);
      const c = this.project(-STAGE_RADIUS, i, 0);
      const d = this.project(STAGE_RADIUS, i, 0);
      line(ctx, a, b);
      line(ctx, c, d);
    }

    ctx.strokeStyle = "rgba(244, 70, 145, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, STAGE_RADIUS * this.stageScale(), STAGE_RADIUS * this.stageScale() * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();

    const labels = [
      ["0 FRONT", 0],
      ["90 RIGHT", 90],
      ["180 BACK", 180],
      ["270 LEFT", 270],
    ];
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = "rgba(230,230,245,0.68)";
    ctx.textAlign = "center";
    for (const [label, angle] of labels) {
      const p = this.lightPosition(angle, 0, STAGE_RADIUS);
      const q = this.project(p.x, p.z, 0);
      ctx.fillText(label, q.x, q.y + 4);
    }
    ctx.restore();
  }

  drawSubject(ctx) {
    const foot = this.project(0, 0, 0);
    const torso = this.project(0, 0, 1.9);
    const head = this.project(0, 0, 3.1);

    ctx.save();
    ctx.fillStyle = "rgba(120, 140, 160, 0.34)";
    ctx.strokeStyle = "rgba(230, 210, 255, 0.75)";
    ctx.lineWidth = 2;
    roundedRect(ctx, torso.x - 23, torso.y - 12, 46, 88, 18);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(head.x, head.y, 23, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(150, 165, 185, 0.42)";
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.moveTo(head.x, head.y + 2);
    ctx.lineTo(head.x, head.y + 38);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("SUBJECT", foot.x, foot.y + 42);
    ctx.restore();
  }

  drawViewReference(ctx) {
    const p = this.project(0, -STAGE_RADIUS + 1.2, 1);
    ctx.save();
    ctx.fillStyle = "#5bf1d7";
    ctx.strokeStyle = "rgba(91,241,215,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 16);
    ctx.lineTo(p.x - 18, p.y + 14);
    ctx.lineTo(p.x + 18, p.y + 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = "rgba(210,255,248,0.75)";
    ctx.textAlign = "center";
    ctx.fillText("FRONT", p.x, p.y + 34);
    ctx.restore();
  }

  drawWorldLight(ctx, state) {
    const pos = this.lightPosition(state.azimuth, state.elevation, state.distance);
    const light = this.project(pos.x, pos.z, pos.y);
    const target = this.project(0, 0, 2);
    const color = kelvinToRgb(state.kelvin);
    const alpha = 0.22 + state.power * 0.08;
    this.drawBeam(ctx, light, target, color, alpha, 40 + state.softbox * 70);
    this.drawLamp(ctx, light, color, 18 + state.power * 2, "KEY");
    this.info.textContent = `主光 ${state.azimuth}° / ${state.elevation}° / ${state.distance.toFixed(1)}m | 强度 ${state.power.toFixed(2)} | ${state.kelvin}K | Gemini 分析原图光影`;
  }

  drawAuxLight(ctx, aux, index) {
    if (!aux.enabled) return;
    const pos = this.lightPosition(aux.azimuth, aux.elevation, aux.distance);
    const light = this.project(pos.x, pos.z, pos.y);
    const target = this.project(0, 0, 1.8);
    const color = kelvinToRgb(aux.color_temp);
    this.drawBeam(ctx, light, target, color, 0.08 + aux.power * 0.2, 20 + aux.softbox * 48);
    this.drawLamp(ctx, light, AUX_COLORS[index] || color, 12 + aux.power * 3, aux.label.slice(0, 4).toUpperCase());
  }

  drawMainModifier(ctx, state) {
    if (state.mainModifier === "none" || state.modifierStrength <= 0.001) return;
    const center = this.project(0, 0, 1.8);
    const projectionSoftness = Math.max(state.softbox, state.modifierSoftness);
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate((state.modifierRotation * Math.PI) / 180);
    ctx.globalAlpha = 0.18 + state.modifierStrength * 0.42;
    ctx.strokeStyle = "#f8d889";
    ctx.filter = `blur(${projectionSoftness * 3}px)`;
    ctx.lineWidth = Math.max(2, 8 * (1 - projectionSoftness));

    if (state.mainModifier === "blinds") {
      for (let y = -90; y <= 90; y += 18 * state.modifierScale) {
        line(ctx, { x: -95, y }, { x: 95, y });
      }
    } else if (state.mainModifier === "window_frame") {
      ctx.strokeRect(-84, -76, 168, 152);
      line(ctx, { x: 0, y: -76 }, { x: 0, y: 76 });
      line(ctx, { x: -84, y: 0 }, { x: 84, y: 0 });
    } else if (state.mainModifier === "lattice") {
      for (let x = -80; x <= 80; x += 40 * state.modifierScale) line(ctx, { x, y: -90 }, { x, y: 90 });
      for (let y = -70; y <= 70; y += 35 * state.modifierScale) line(ctx, { x: -90, y }, { x: 90, y });
    } else if (state.mainModifier === "foliage") {
      for (let i = 0; i < 22; i++) {
        const x = Math.sin(i * 12.989) * 82;
        const y = Math.cos(i * 8.231) * 72;
        ctx.beginPath();
        ctx.ellipse(x, y, 6 + state.modifierScale * 5, 2 + state.modifierScale * 3, i, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (state.mainModifier === "caustics") {
      for (let y = -60; y <= 60; y += 24 * state.modifierScale) {
        ctx.beginPath();
        ctx.moveTo(-90, y);
        ctx.bezierCurveTo(-45, y - 16, 0, y + 16, 45, y);
        ctx.bezierCurveTo(60, y - 8, 75, y + 10, 90, y);
        ctx.stroke();
      }
    } else if (state.mainModifier === "stained_glass") {
      const colors = ["#f6b56b", "#70d7d6", "#dd70b6", "#8db4ff"];
      for (let i = 0; i < 8; i++) {
        ctx.strokeStyle = colors[i % colors.length];
        ctx.beginPath();
        ctx.moveTo(-84 + i * 24, -72);
        ctx.lineTo(-62 + i * 18, -8);
        ctx.lineTo(-90 + i * 25, 70);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawBeam(ctx, from, to, color, alpha, spread) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const left = {
      x: to.x + Math.cos(angle + Math.PI / 2) * spread,
      y: to.y + Math.sin(angle + Math.PI / 2) * spread,
    };
    const right = {
      x: to.x + Math.cos(angle - Math.PI / 2) * spread,
      y: to.y + Math.sin(angle - Math.PI / 2) * spread,
    };
    ctx.save();
    const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    gradient.addColorStop(0, withAlpha(color, alpha));
    gradient.addColorStop(1, withAlpha(color, 0.02));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = withAlpha(color, 0.45);
    ctx.lineWidth = 1.5;
    line(ctx, from, to);
    ctx.restore();
  }

  drawLamp(ctx, point, color, radius, label) {
    ctx.save();
    const gradient = ctx.createRadialGradient(point.x, point.y, 1, point.x, point.y, radius * 2.4);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.35, withAlpha(color, 0.5));
    gradient.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, point.x, point.y - radius - 7);
    ctx.restore();
  }

  drawOverlay(ctx, state) {
    ctx.save();
    ctx.fillStyle = "rgba(5, 5, 10, 0.62)";
    roundedRect(ctx, 14, 14, 260, 82, 9);
    ctx.fill();
    const barWidth = 220;
    const activeRatio = state.power / 5;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundedRect(ctx, 32, 57, barWidth, 7, 4);
    ctx.fill();
    const grad = ctx.createLinearGradient(32, 0, 32 + barWidth, 0);
    grad.addColorStop(0, "#4ee6d2");
    grad.addColorStop(0.5, "#ffe08a");
    grad.addColorStop(1, "#ff4e94");
    ctx.fillStyle = grad;
    roundedRect(ctx, 32, 57, barWidth * activeRatio, 7, 4);
    ctx.fill();
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillStyle = "#f2d481";
    ctx.fillText("Gemini Lighting Expert Stage", 32, 36);
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText("Relighting only / CFG conditioning", 32, 84);
    ctx.restore();
  }

  renderAuxList() {
    const aux = this.state.aux;
    this.auxList.innerHTML = "";
    for (let i = 0; i < AUX_LABELS.length; i++) {
      const row = document.createElement("div");
      row.className = "qwen-aux-row";
      const light = normalizeAuxLight(aux[i], i);
      if (i === this.selectedAuxIndex) row.classList.add("selected");
      const swatch = document.createElement("span");
      swatch.className = "qwen-aux-swatch";
      swatch.style.background = AUX_COLORS[i];
      const label = document.createElement("span");
      label.textContent = `${AUX_LABELS[i]} ${light.enabled ? `${light.azimuth}°` : "off"}`;
      const toggle = createButton(light.enabled ? "关" : "开", () => {
        const next = parseAuxLights(getWidgetValue(this.node, "aux_lights_json", "[]"));
        next[i] = { ...normalizeAuxLight(next[i], i), enabled: !light.enabled, label: AUX_LABELS[i] };
        setWidgetValue(this.node, "aux_lights_json", serializeAuxLights(next));
        this.sync();
      });
      row.addEventListener("click", () => {
        this.selectedAuxIndex = i;
        this.sync();
      });
      row.append(swatch, label, toggle);
      this.auxList.appendChild(row);
    }
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function withAlpha(hex, alpha) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function buildRoot() {
  const root = document.createElement("div");
  root.className = "qwen-cine-root";
  root.innerHTML = `
    <style>
      .qwen-cine-root {
        width: 100%;
        height: ${DEFAULT_PANEL_HEIGHT}px !important;
        min-height: ${DEFAULT_PANEL_HEIGHT}px !important;
        max-height: ${DEFAULT_PANEL_HEIGHT}px !important;
        flex: 0 0 auto !important;
        box-sizing: border-box;
        color: #e8e6f4;
        background: #090810;
        border: 1px solid rgba(244, 70, 145, 0.32);
        border-radius: 8px;
        overflow: hidden;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .qwen-cine-shell {
        display: grid;
        grid-template-columns: minmax(620px, 1fr) minmax(300px, 340px);
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }
      .qwen-cine-left {
        display: grid;
        grid-template-rows: minmax(${MIN_STAGE_HEIGHT}px, 1fr) 170px;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: #07070c;
      }
      .qwen-cine-stage {
        position: relative;
        min-width: 0;
        min-height: ${MIN_STAGE_HEIGHT}px;
        overflow: hidden;
        background: radial-gradient(circle at 50% 40%, rgba(74, 48, 96, 0.22), transparent 58%), #07070c;
      }
      .qwen-cine-stage canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .qwen-cine-info {
        position: absolute;
        left: 12px;
        right: 12px;
        bottom: 12px;
        padding: 8px 10px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 6px;
        background: rgba(5, 5, 10, 0.76);
        color: rgba(245,245,255,0.88);
        font: 12px ui-monospace, monospace;
        pointer-events: none;
      }
      .qwen-cine-left-bottom {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        padding: 10px;
        border-top: 1px solid rgba(255,255,255,0.08);
        background: linear-gradient(180deg, rgba(12,11,18,0.98), rgba(8,8,12,0.98));
        min-height: 0;
      }
      .qwen-cine-side {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px;
        border-left: 1px solid rgba(255,255,255,0.08);
        background: linear-gradient(180deg, rgba(24,20,33,0.96), rgba(11,10,15,0.96));
        min-height: 0;
        overflow: hidden auto;
      }
      .qwen-cine-section {
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 7px;
        background: rgba(255,255,255,0.035);
        padding: 9px;
      }
      .qwen-cine-left-bottom .qwen-cine-section {
        min-height: 0;
        overflow: hidden;
      }
      .qwen-cine-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: #f2d481;
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 8px;
      }
      .qwen-cine-presets,
      .qwen-cine-status {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }
      .qwen-cine-button {
        min-height: 28px;
        color: #e9e7f5;
        background: #1d1b27;
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 6px;
        cursor: pointer;
        font-size: 11px;
      }
      .qwen-cine-button:hover {
        background: #2a2637;
        border-color: rgba(244,70,145,0.65);
      }
      .qwen-cine-toggle[data-enabled="true"] {
        color: #07110f;
        background: linear-gradient(135deg, #70ffe7, #f2d481);
        border-color: rgba(255,255,255,0.28);
      }
      .qwen-cine-range {
        display: block;
        margin: 9px 0;
      }
      .qwen-cine-range-top {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        color: rgba(255,255,255,0.68);
        font-size: 11px;
        margin-bottom: 4px;
      }
      .qwen-cine-range strong {
        color: #80fff0;
        font-weight: 700;
      }
      .qwen-cine-range input {
        width: 100%;
        accent-color: #f44691;
      }
      .qwen-cine-range[data-disabled="true"] {
        opacity: 0.45;
      }
      .qwen-cine-note {
        margin: 8px 0 0;
        color: rgba(255,255,255,0.50);
        font-size: 10px;
        line-height: 1.45;
      }
      .qwen-cine-select {
        display: grid;
        grid-template-columns: 84px 1fr;
        align-items: center;
        gap: 8px;
        color: rgba(255,255,255,0.68);
        font-size: 11px;
        margin: 9px 0;
      }
      .qwen-cine-select select {
        min-width: 0;
        color: #e9e7f5;
        background: #1d1b27;
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 6px;
        height: 28px;
        box-sizing: border-box;
        padding: 0 8px;
      }
      .qwen-cine-textarea {
        display: grid;
        grid-template-columns: 72px 1fr;
        gap: 8px;
        color: rgba(255,255,255,0.68);
        font-size: 11px;
        margin: 0 0 8px;
      }
      .qwen-cine-textarea textarea {
        min-width: 0;
        height: 58px;
        resize: none;
        color: #e9e7f5;
        background: #1d1b27;
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 6px;
        box-sizing: border-box;
        padding: 7px 8px;
        font: 11px ui-sans-serif, system-ui, sans-serif;
      }
      .qwen-cine-secret {
        display: grid;
        grid-template-columns: 96px 1fr;
        align-items: center;
        gap: 8px;
        color: rgba(255,255,255,0.68);
        font-size: 11px;
        margin: 0 0 8px;
      }
      .qwen-cine-secret input {
        min-width: 0;
        height: 28px;
        color: #e9e7f5;
        background: #1d1b27;
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 6px;
        box-sizing: border-box;
        padding: 0 8px;
        font: 11px ui-monospace, monospace;
      }
      .qwen-aux-row {
        display: grid;
        grid-template-columns: 12px 1fr 36px;
        align-items: center;
        gap: 7px;
        min-height: 28px;
        color: rgba(255,255,255,0.76);
        font-size: 11px;
        border-radius: 5px;
        padding: 0 4px;
        cursor: pointer;
      }
      .qwen-aux-row.selected {
        background: rgba(244,70,145,0.18);
        color: #ffffff;
      }
      .qwen-aux-swatch {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        box-shadow: 0 0 12px currentColor;
      }
    </style>
    <div class="qwen-cine-shell">
      <div class="qwen-cine-left">
        <div class="qwen-cine-stage">
          <canvas></canvas>
          <div class="qwen-cine-info" data-role="stage-info"></div>
        </div>
        <div class="qwen-cine-left-bottom">
          <div class="qwen-cine-section">
            <div class="qwen-cine-title"><span>光影目标 / 光影专家</span><span>Gemini 3 Flash Preview</span></div>
            <div data-role="prompt-panel"></div>
          </div>
        </div>
      </div>
      <div class="qwen-cine-side">
        <div class="qwen-cine-section">
          <div class="qwen-cine-title"><span>工作台</span><span>Lighting Only</span></div>
          <div class="qwen-cine-status" data-role="status-panel"></div>
        </div>
        <div class="qwen-cine-section">
          <div class="qwen-cine-title"><span>输出保护</span><span>Flux Lock</span></div>
          <div data-role="flux-lock-panel"></div>
        </div>
        <div class="qwen-cine-section">
          <div class="qwen-cine-title"><span>主光预设</span><span>Key Presets</span></div>
          <div class="qwen-cine-presets" data-role="preset-panel"></div>
        </div>
        <div class="qwen-cine-section">
          <div class="qwen-cine-title"><span>主光控制</span><span>Key</span></div>
          <div data-role="control-panel"></div>
        </div>
        <div class="qwen-cine-section">
          <div class="qwen-cine-title"><span>主光投影附件</span><span>Gobo / Projection</span></div>
          <div data-role="modifier-panel"></div>
        </div>
        <div class="qwen-cine-section">
          <div class="qwen-cine-title"><span>辅助灯层</span><span>3 Lights</span></div>
          <div data-role="aux-list" style="margin-top:8px;"></div>
          <div data-role="aux-detail-panel" style="margin-top:8px;"></div>
        </div>
      </div>
    </div>
  `;
  return root;
}

app.registerExtension({
  name: "ComfyUI.QwenCinematicLighting.Stage3D",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS || nodeType.prototype._qwenCineWorkbenchPatched) return;
    nodeType.prototype._qwenCineWorkbenchPatched = true;

    const originalOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (...args) {
      const result = originalOnConfigure?.apply(this, args);
      requestAnimationFrame(() => {
        this._qwenCineStage?.resize();
        this._qwenCineStage?.sync();
      });
      return result;
    };

    const originalOnAdded = nodeType.prototype.onAdded;
    nodeType.prototype.onAdded = function (...args) {
      const result = originalOnAdded?.apply(this, args);
      requestAnimationFrame(() => {
        this._qwenCineStage?.resize();
        this._qwenCineStage?.sync();
      });
      return result;
    };
  },
  async nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS && node.constructor?.comfyClass !== NODE_CLASS) return;
    if (node._qwenCineStageWidget) return;

    node.color = "#38223d";
    node.bgcolor = "#111018";

    const root = buildRoot();
    const widget = node.addDOMWidget("virtual_lighting_stage", "QWEN_CINEMATIC_STAGE", root, {
      getValue() {
        return "";
      },
      setValue() {},
    });
    const widgetIndex = node.widgets?.indexOf(widget) ?? -1;
    if (widgetIndex > 0) {
      node.widgets.splice(widgetIndex, 1);
      node.widgets.unshift(widget);
    }

    widget.computeSize = function (width) {
      const resolvedWidth = panelWidth(width);
      applyPanelSize(root, resolvedWidth);
      requestAnimationFrame(() => {
        node._qwenCineStage?.resize();
        node._qwenCineStage?.render();
      });
      return [resolvedWidth, DEFAULT_PANEL_HEIGHT];
    };

    node._qwenCineStageWidget = widget;
    node._qwenCineStage = new VirtualLightingStage(node, root);

    const originalOnResize = node.onResize;
    node.onResize = function (...args) {
      const result = originalOnResize?.apply(this, args);
      requestAnimationFrame(() => {
        node._qwenCineStageWidget?.computeSize?.(node.size?.[0] ? node.size[0] - 32 : DEFAULT_PANEL_WIDTH);
        node._qwenCineStage?.sync();
      });
      return result;
    };

    const originalOnConfigure = node.onConfigure;
    node.onConfigure = function (...args) {
      const result = originalOnConfigure?.apply(this, args);
      requestAnimationFrame(() => {
        node._qwenCineStage?.resize();
        node._qwenCineStage?.sync();
      });
      return result;
    };

    resetNodeToDefaultSize(node);
    requestAnimationFrame(() => {
      node._qwenCineStage?.hideNativeLightingWidgets();
      node._qwenCineStage?.sync();
      app.graph.setDirtyCanvas(true, true);
    });
    setTimeout(() => {
      node._qwenCineStage?.hideNativeLightingWidgets();
      node._qwenCineStage?.sync();
      app.graph.setDirtyCanvas(true, true);
    }, 250);
    setTimeout(() => {
      node._qwenCineStage?.sync();
    }, 1000);
  },
});
