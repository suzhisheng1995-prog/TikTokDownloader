const http = require("http"),
  fs = require("fs"),
  crypto = require("crypto");
const PORT = 8787,
  DB = "/opt/ruiying/data.json",
  SECRET = process.env.APP_SECRET;
if (!SECRET) throw new Error("APP_SECRET required");
const load = () => {
  try {
    return JSON.parse(fs.readFileSync(DB, "utf8"));
  } catch {
    return { codes: {}, tokens: {}, settings: {}, logs: [] };
  }
};
const save = (d) => {
  fs.mkdirSync("/opt/ruiying", { recursive: true });
  fs.writeFileSync(DB, JSON.stringify(d, null, 2), { mode: 0o600 });
};
const send = (r, s, b, t = "application/json; charset=utf-8") => {
  r.writeHead(s, {
    "content-type": t,
    "access-control-allow-origin": "*",
    "access-control-allow-headers":
      "authorization,content-type,prefer,x-request-id,x-image-model,x-admin-username,x-admin-password",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  });
  r.end(t.startsWith("application/json") ? JSON.stringify(b) : b);
};
const body = (req) =>
  new Promise((ok, no) => {
    let x = "";
    req.on("data", (c) => {
      x += c;
      if (x.length > 40e6) no(Error("too large"));
    });
    req.on("end", () => {
      try {
        ok(x ? JSON.parse(x) : {});
      } catch (e) {
        no(e);
      }
    });
    req.on("error", no);
  });
const hash = (x) => crypto.createHash("sha256").update(String(x)).digest("hex");
const token = () => crypto.randomBytes(32).toString("hex");
const shotSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    purpose: { type: "string" },
    prompt: { type: "string" },
    reference_image_index: { type: "integer", minimum: 0, maximum: 5 },
    required_text: { type: "array", items: { type: "string" } },
  },
  required: [
    "title",
    "purpose",
    "prompt",
    "reference_image_index",
    "required_text",
  ],
};
const planSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    product_description: { type: "string" },
    selling_points: { type: "array", items: { type: "string" } },
    target_audiences: { type: "array", items: { type: "string" } },
    dimensions_found: { type: "array", items: { type: "string" } },
    shots: { type: "array", minItems: 9, maxItems: 9, items: shotSchema },
    detail_shots: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: shotSchema,
    },
  },
  required: [
    "summary",
    "product_description",
    "selling_points",
    "target_audiences",
    "dimensions_found",
    "shots",
    "detail_shots",
  ],
};
const basePlannerInstruction = `你是专业的美国 TikTok Shop 电商视觉策划师。必须在分析商品标题、用户要求和全部参考图的同一次调用中，同时生成 product_description、9 张商品主图规划 shots 和 2 张详情页图片规划 detail_shots，并只返回符合 schema 的 JSON。product_description 必须是自然、地道的美式英文，采用适合美国 TikTok Shop 商品详情页和手机阅读的卖点列表格式，生成 4–6 条，每条独占一段并严格使用“• 【Short Feature Title】 Detailed benefit explanation.”格式。方括号标题控制在 2–6 个英文单词，后面的说明用 1–3 句讲清楚该特点对用户的实际价值、适用方式或场景；整段建议 150–280 个英文单词。卖点顺序优先为：核心用途或体验、多种使用方式、参考图可确认的规格或结构、适用人群、适用场景。只允许写标题、用户要求或参考图能够明确确认的信息；不得编造材质、尺寸、弹性、保暖性、功能、认证、功效、发货方式、产地、包装、配件、库存或折扣，不得使用虚假稀缺、绝对化、医疗化或无法证实的宣传。没有证据时应省略该卖点，不能猜测。product_description 中不得出现中文、HTML 标签、Markdown 标题或额外的开场白和结尾，只输出英文项目符号卖点。shots 必须正好 9 条，分别覆盖主图、卖点、场景、细节、尺寸或对比等不同销售目的。detail_shots 必须正好 2 条，默认按 3:4 竖版详情页构图规划：第 1 张整合 3–5 个可确认核心卖点与局部细节，使用简短英文信息层级；第 2 张展示目标人群、使用场景或多种使用方式，有真实尺寸时可整合尺寸信息。两张详情图不得与九张主图重复构图。每个任务只选一张参考图，reference_image_index 从 0 开始。不得改变商品真实外观、颜色、形状、结构、图案、Logo、配件、数量和比例；不得夸大或虚构功能、材质、认证、疗效、包装。可更换背景、构图、道具和美国人物。只有参考图中清晰可读的尺寸才能原样保留，不得编造。prompt 用中文，画面短文案用简洁自然的英文并写入 required_text。title 用“图片类型-具体主题”。每条 prompt 必须完整独立，明确画面用途、商品主体、真实颜色、构图、背景/人物/道具、必须保留项、禁止项、英文短文案；shots 使用用户选择的画幅，detail_shots 明确要求 3:4 竖版。`;
const plannerInstruction =
  basePlannerInstruction.replaceAll("3:4", "4:5") +
  "\n详情图必须使用生图模型原生支持的 4:5 画幅，不得要求或输出自定义像素尺寸；构图和文字安全区必须适配美国 TikTok Shop 移动端屏幕。";
const admin = (req) =>
  req.headers["x-admin-username"] === (process.env.ADMIN_USERNAME || "") &&
  crypto.timingSafeEqual(
    Buffer.from(hash(req.headers["x-admin-password"] || "")),
    Buffer.from(hash(process.env.ADMIN_PASSWORD || "")),
  );
const auth = (req) => {
  const t = (req.headers.authorization || "").replace(/^Bearer /, "");
  const d = load(),
    v = d.tokens[hash(t)];
  return v &&
    (!v.expires_at || Date.now() < v.expires_at) &&
    d.codes[v.code]?.active
    ? v
    : null;
};
const record = (_, code, type, images, status, meta = {}) => {
  const d = load();
  d.logs = Array.isArray(d.logs) ? d.logs : [];
  d.logs.push({
    ts: Date.now(),
    code,
    type,
    images: Number(images) || 0,
    status,
    ...meta,
  });
  if (d.logs.length > 50000) d.logs = d.logs.slice(-50000);
  save(d);
};
const providerDefinitions = {
  katu: { name: "咖图", modelsUrl: "https://www.katuai.cn/v1/models", imageBase: "https://www.katuai.cn/v1", mode: "katu" },
  teamo: { name: "TeamoRouter", modelsUrl: "https://api.teamorouter.cn/v1/models", imageBase: "https://api.teamorouter.cn/v1", chatUrl: "https://api.teamorouter.cn/v1/chat/completions", mode: "openai" },
  fusheng: { name: "浮生云算", modelsUrl: "https://fushengyunsuan.com/v1/models", imageBase: "https://image.fushengyunsuan.cn/v1", chatUrl: "https://fushengyunsuan.com/v1/chat/completions", mode: "openai" },
  codex789: { name: "Codex789", modelsUrl: "https://www.codex789.com/v1/models", imageBase: "https://www.codex789.com/v1", chatUrl: "https://www.codex789.com/v1/chat/completions", mode: "openai" },
};
const gatewayImageJobs = new Map();
setInterval(() => { const cutoff = Date.now() - 2 * 60 * 60 * 1000; for (const [id, job] of gatewayImageJobs) if (job.updated_at < cutoff) gatewayImageJobs.delete(id); }, 10 * 60 * 1000).unref();
const modelKind = (id, name) => {
  const value = `${id} ${name}`.toLowerCase();
  if (/image|banana|seedream|imagen|flux|grok.*imagine|nano.?banana/.test(value)) return "image";
  if (/video|sora|veo|kling|embedding|rerank|speech|tts|whisper|audio/.test(value)) return "other";
  return "language";
};
const normalizeProviderModels = (provider, payload) => {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return rows.map((item) => {
    const id = String(item?.id || item?.model || item?.name || "").trim();
    const displayName = String(item?.display_name || item?.displayName || item?.name || id).trim();
    const pricing = item?.api_price_by_size || item?.price_by_size || item?.pricing || item?.prices || item?.price || item?.cost || null;
    return { id, name: displayName || id, pricing, kind: modelKind(id, displayName) };
  }).filter((item) => item.id).slice(0, 500);
};
async function syncProviderModels(provider, key) {
  const definition = providerDefinitions[provider];
  if (!definition || !key) throw new Error(`${definition?.name || provider} 尚未配置 API Key`);
  const response = await fetch(definition.modelsUrl, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let payload; try { payload = JSON.parse(text); } catch { throw new Error(`${definition.name}模型列表返回格式异常（HTTP ${response.status}）`); }
  if (!response.ok) throw new Error(payload?.error?.message || `${definition.name}同步失败（HTTP ${response.status}）`);
  const models = normalizeProviderModels(provider, payload);
  if (!models.length) throw new Error(`${definition.name}没有返回可用模型`);
  return models;
}
async function proxy(req, res, path, key, usage) {
  let data = null;
  try {
    data = req.method === "POST" ? await body(req) : null;
    if (data && usage?.type === "generate" && usage.model)
      data.model = usage.model;
    const headers = {
      authorization: `Bearer ${key}`,
      ...(data ? { "content-type": "application/json" } : {}),
    };
    if (req.headers.prefer) headers.prefer = req.headers.prefer;
    if (req.headers["x-request-id"])
      headers["x-request-id"] = req.headers["x-request-id"];
    const requestBody = data ? JSON.stringify(data) : undefined;
    let u, lastNetworkError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        u = await fetch(path, {
          method: req.method,
          headers,
          body: requestBody,
          signal: AbortSignal.timeout(90000),
        });
        break;
      } catch (error) {
        lastNetworkError = error;
        const reason = error?.cause?.code || error?.code || error?.name || "UPSTREAM_NETWORK_ERROR";
        console.error("upstream connection attempt failed", { path, attempt, reason, message: error?.message });
        const safeToRetry = /CONNECT_TIMEOUT|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN/i.test(String(reason));
        if (!safeToRetry || attempt >= 3) break;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
      }
    }
    if (!u) throw lastNetworkError || new Error("UPSTREAM_NETWORK_ERROR");
    const raw = Buffer.from(await u.arrayBuffer());
    let images = 0;
    if (usage?.type === "generate" && u.ok) {
      try {
        const out = JSON.parse(raw.toString("utf8"));
        images = Array.isArray(out.data)
          ? out.data.length
          : Array.isArray(out.images)
            ? out.images.length
            : Array.isArray(out.task_ids)
              ? out.task_ids.length
              : Number(data?.n || data?.count) || 1;
      } catch {
        images = Number(data?.n || data?.count) || 1;
      }
    }
    if (usage) record(usage.db, usage.code, usage.type, images, u.status);
    res.writeHead(u.status, {
      "content-type": u.headers.get("content-type") || "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(raw);
  } catch (error) {
    const requestId = String(req.headers["x-request-id"] || "");
    const reason = error?.cause?.code || error?.code || error?.name || "UPSTREAM_NETWORK_ERROR";
    if (usage)
      record(usage.db, usage.code, usage.type, 0, 503, {
        request_id: requestId,
        billing_status: "not_accepted",
        upstream_error: String(reason),
      });
    console.error("upstream proxy unavailable", { path, requestId, reason, message: error?.message });
    return send(res, 503, {
      error: {
        message: "咖图上游暂时无法连接，本次请求未被上游接收，请稍后再试。",
        code: "UPSTREAM_UNAVAILABLE",
        billing_status: "not_accepted",
        request_id: requestId,
      },
    });
  }
}
async function openAiImageGenerate(req, res, key, usage, provider) {
  const requestId = String(req.headers["x-request-id"] || "");
  const definition = providerDefinitions[provider];
  try {
    const data = await body(req);
    data.model = usage.model;
    const reference = Array.isArray(data.reference_images) ? data.reference_images[0] : "";
    let response;
    if (/^data:image\//i.test(reference)) {
      const match = /^data:([^;]+);base64,(.+)$/s.exec(reference);
      if (!match) return send(res, 400, { error: { message: "参考图格式无效" } });
      const form = new FormData();
      form.set("model", data.model);
      form.set("prompt", String(data.prompt || ""));
      form.set("image", new Blob([Buffer.from(match[2], "base64")], { type: match[1] }), "reference.png");
      if (data.size) form.set("size", String(data.size));
      if (data.aspect_ratio) form.set("aspect_ratio", String(data.aspect_ratio));
      if (data.response_format) form.set("response_format", String(data.response_format));
      response = await fetch(`${definition.imageBase}/images/edits`, { method: "POST", headers: { authorization: `Bearer ${key}`, "x-request-id": requestId }, body: form, signal: AbortSignal.timeout(600000) });
    } else {
      delete data.reference_images;
      response = await fetch(`${definition.imageBase}/images/generations`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-request-id": requestId }, body: JSON.stringify(data), signal: AbortSignal.timeout(600000) });
    }
    const raw = Buffer.from(await response.arrayBuffer());
    let images = 0;
    if (response.ok) {
      try { const parsed = JSON.parse(raw.toString("utf8")); images = Array.isArray(parsed.data) ? parsed.data.length : 1; } catch { images = 1; }
    }
    record(usage.db, usage.code, `generate_${provider}`, images, response.status, { request_id: requestId, provider });
    res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" });
    return res.end(raw);
  } catch (error) {
    const reason = error?.cause?.code || error?.code || error?.name || "UPSTREAM_NETWORK_ERROR";
    record(usage.db, usage.code, `generate_${provider}`, 0, 503, { request_id: requestId, provider, billing_status: "unknown", upstream_error: String(reason) });
    return send(res, 503, { error: { message: `${definition.name}生图线路暂时不可用，请核对该平台账单后再重试。`, code: "UPSTREAM_UNAVAILABLE", billing_status: "unknown", request_id: requestId } });
  }
}
async function queueOpenAiImageGenerate(req, res, key, usage, provider) {
  const requestId = String(req.headers["x-request-id"] || crypto.randomUUID()), id = `gw-${crypto.randomUUID()}`;
  const definition = providerDefinitions[provider], data = await body(req);
  data.model = usage.model;
  gatewayImageJobs.set(id, { id, status: "queued", progress: { total: 1, queued: 1, running: 0, succeeded: 0, failed: 0 }, created_at: Date.now(), updated_at: Date.now(), request_id: requestId, provider });
  send(res, 202, { id, status: "queued", request_id: requestId });
  (async () => {
    const job = gatewayImageJobs.get(id); if (!job) return;
    job.status = "running"; job.progress = { total: 1, queued: 0, running: 1, succeeded: 0, failed: 0 }; job.updated_at = Date.now();
    try {
      const reference = Array.isArray(data.reference_images) ? data.reference_images[0] : "";
      let response;
      if (/^data:image\//i.test(reference)) {
        const match = /^data:([^;]+);base64,(.+)$/s.exec(reference); if (!match) throw new Error("参考图格式无效");
        const form = new FormData(); form.set("model", data.model); form.set("prompt", String(data.prompt || "")); form.set("image", new Blob([Buffer.from(match[2], "base64")], { type: match[1] }), "reference.png");
        if (data.size) form.set("size", String(data.size)); if (data.aspect_ratio) form.set("aspect_ratio", String(data.aspect_ratio)); if (data.response_format) form.set("response_format", String(data.response_format));
        response = await fetch(`${definition.imageBase}/images/edits`, { method: "POST", headers: { authorization: `Bearer ${key}`, "x-request-id": requestId }, body: form, signal: AbortSignal.timeout(20 * 60 * 1000) });
      } else {
        delete data.reference_images;
        response = await fetch(`${definition.imageBase}/images/generations`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-request-id": requestId }, body: JSON.stringify(data), signal: AbortSignal.timeout(20 * 60 * 1000) });
      }
      const text = await response.text(); let payload; try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: { message: `上游返回了非 JSON 内容（HTTP ${response.status}）` } }; }
      if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `${definition.name}生图失败（HTTP ${response.status}）`);
      const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.images) ? payload.images : [payload];
      job.status = "succeeded"; job.data = rows; job.result = payload; job.progress = { total: 1, queued: 0, running: 0, succeeded: 1, failed: 0 }; job.updated_at = Date.now();
      record(usage.db, usage.code, `generate_${provider}`, Math.max(1, rows.length), response.status, { request_id: requestId, provider, gateway_job_id: id });
    } catch (error) {
      const reason = error?.cause?.code || error?.code || error?.name || "UPSTREAM_NETWORK_ERROR";
      job.status = "failed"; job.error = { message: `${definition.name}生图失败：${error.message}`, code: String(reason) }; job.progress = { total: 1, queued: 0, running: 0, succeeded: 0, failed: 1 }; job.updated_at = Date.now();
      record(usage.db, usage.code, `generate_${provider}`, 0, 503, { request_id: requestId, provider, gateway_job_id: id, upstream_error: String(reason) });
    }
  })();
}
async function createPlan(req, res, planner, usage) {
  const x = await body(req),
    images = Array.isArray(x.images) ? x.images.slice(0, 6) : [];
  if (!x.title || !images.length)
    return send(res, 400, {
      error: { message: "商品标题和至少一张参考图是必填项" },
    });
  const key = planner?.key, chatUrl = planner?.url || "https://x-llm.net/v1/chat/completions", plannerModel = planner?.model || "gpt-5.6-terra";
  if (!key)
    return send(res, 503, { error: { message: "管理员尚未配置规划 API Key" } });
  const content = [
    {
      type: "text",
      text: `Product title: ${x.title}\nUser requirements: ${x.requirements || "生成 9 张美国 TikTok Shop 商品主图和 2 张 3:4 详情图。"}`,
    },
    ...images.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  const common = {
    model: plannerModel,
    messages: [
      {
        role: "system",
        content:
          plannerInstruction +
          "\nReturn only valid JSON matching the requested schema.",
      },
      { role: "user", content },
    ],
    temperature: 0.35,
  };
  let u = await fetch(chatUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...common,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "tiktok_image_plan",
          strict: true,
          schema: planSchema,
        },
      },
    }),
  });
  let out = await u.json();
  if (
    !u.ok &&
    /response_format|json_schema|schema/i.test(out.error?.message || "")
  ) {
    u = await fetch(chatUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...common,
        response_format: { type: "json_object" },
      }),
    });
    out = await u.json();
  }
  if (!u.ok) {
    if (usage) record(usage.db, usage.code, "plan", 0, u.status);
    return send(res, u.status, {
      error: { message: out.error?.message || "规划服务请求失败" },
    });
  }
  const parsePlan = (payload) => {
    const value = payload?.choices?.[0]?.message?.content;
    if (typeof value !== "string") return value;
    try { return JSON.parse(value.replace(/^```json\s*|\s*```$/g, "")); }
    catch { return null; }
  };
  let result = parsePlan(out);
  if (!Array.isArray(result?.shots) || result.shots.length !== 9 || !Array.isArray(result?.detail_shots) || result.detail_shots.length !== 2) {
    const repair = await fetch(chatUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        ...common,
        messages: [
          ...common.messages,
          { role: "assistant", content: JSON.stringify(result || out.choices?.[0]?.message?.content || {}) },
          { role: "user", content: "修复上面的结果并重新输出完整 JSON。shots 必须正好 9 条，detail_shots 必须正好 2 条，其他字段严格符合要求；只输出 JSON。" },
        ],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(120000),
    });
    const repaired = await repair.json();
    if (repair.ok) result = parsePlan(repaired);
  }
  const fallbackShots = [
    ["主图-完整商品展示", "生成美国 TikTok Shop 商品主图，完整清晰展示商品，保持参考图中的真实外观、颜色、结构、图案和比例，干净明亮背景，不添加无法确认的配件或功能。"],
    ["卖点图-核心外观", "生成商品核心外观卖点图，突出商品造型与可见设计细节，保持商品与参考图一致，使用适合美国移动端电商的简洁构图。"],
    ["场景图-日常使用", "生成自然真实的日常使用场景图，商品为视觉中心，不改变商品外观，不虚构材质、尺寸或功能。"],
    ["细节图-表面与结构", "生成商品局部细节特写，清晰呈现参考图可确认的表面、边缘与结构，保持真实颜色。"],
    ["展示图-多角度构图", "生成商品另一展示角度，完整保留商品真实造型与比例，背景简洁，适配美国 TikTok Shop。"],
    ["场景图-生活方式", "生成自然生活方式场景，允许更换背景和人物，但商品本身必须与参考图一致。"],
    ["卖点图-设计特点", "生成商品可见设计特点卖点图，只描述参考图能够确认的信息，使用简短自然英文。"],
    ["对比图-造型展示", "生成整洁的商品造型展示图，通过构图突出商品，不制作未经证实的功能或效果对比。"],
    ["主图-补充展示", "生成补充商品主图，保持商品外观、颜色、图案、Logo、配件数量与参考图完全一致。"],
  ];
  const fallbackDetails = [
    ["详情图-核心卖点与细节", "生成原生 4:5 竖版详情图，整合商品完整展示和 3 个参考图可确认的外观细节，英文层级简洁，适配移动端。"],
    ["详情图-使用场景展示", "生成原生 4:5 竖版详情图，展示目标用户和自然使用场景，不编造尺寸、材质、功能、认证或包装信息。"],
  ];
  result = result && typeof result === "object" ? result : {};
  const normalizeShot = (shot, fallback, index) => ({
    title: String(shot?.title || fallback[0]),
    purpose: String(shot?.purpose || fallback[0]),
    prompt: String(shot?.prompt || fallback[1]),
    reference_image_index: Math.max(0, Math.min(images.length - 1, Number(shot?.reference_image_index) || (index % images.length))),
    required_text: Array.isArray(shot?.required_text) ? shot.required_text.map(String).slice(0, 8) : [],
  });
  const sourceShots = Array.isArray(result.shots) ? result.shots : [];
  const sourceDetails = Array.isArray(result.detail_shots) ? result.detail_shots : [];
  result.shots = fallbackShots.map((fallback, index) => normalizeShot(sourceShots[index], fallback, index));
  result.detail_shots = fallbackDetails.map((fallback, index) => normalizeShot(sourceDetails[index], fallback, index));
  result.summary = String(result.summary || `已根据商品标题和 ${images.length} 张参考图生成完整电商套图方案。`);
  result.selling_points = Array.isArray(result.selling_points) ? result.selling_points.map(String) : [];
  result.target_audiences = Array.isArray(result.target_audiences) ? result.target_audiences.map(String) : [];
  result.dimensions_found = Array.isArray(result.dimensions_found) ? result.dimensions_found.map(String) : [];
  result.product_description = String(result.product_description || `• 【Product Overview】 ${String(x.title).slice(0, 180)}. Review the product images for its visible design and intended presentation.\n\n• 【Visual Details】 The listing images show the product's appearance from multiple angles for easier shopping decisions.`);
  if (usage) record(usage.db, usage.code, "plan", 0, 200);
  return send(res, 200, result);
}
const ui = `<!doctype html><meta charset="utf-8"><title>瑞滢AI 管理后台</title><style>body{font:14px Arial;background:#f5f5f2;margin:40px;max-width:1050px}input,button{padding:10px;margin:5px}section{background:white;padding:20px;margin:15px 0;border:1px solid #ddd}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #eee;text-align:left}</style><h1>瑞滢AI 管理后台</h1><input id=p type=password placeholder="管理密码"><button onclick=load()>登录/刷新</button><section><h3>API设置</h3><input id=katu placeholder="咖图 API Key"><input id=xllm placeholder="X-LLM API Key"><button onclick=settings()>保存</button><small>留空表示不修改</small></section><section><h3>创建激活码</h3><input id=days value=365 type=number><span>天</span><button onclick=create()>生成激活码</button><pre id=newcode></pre></section><section><h3>激活码</h3><table><thead><tr><th>激活码</th><th>状态</th><th>设备</th><th>到期</th><th></th></tr></thead><tbody id=list></tbody></table></section><script>const h=()=>({'content-type':'application/json','x-admin-password':p.value});async function load(){let r=await fetch('/admin/codes',{headers:h()});if(!r.ok)return alert('密码错误');let x=await r.json();list.innerHTML=x.map(v=>'<tr><td>'+v.code+'</td><td>'+v.active+'</td><td>'+(v.device||'')+'</td><td>'+new Date(v.expires_at).toLocaleString()+'</td><td><button onclick="toggle(\''+v.code+'\')">启用/禁用</button></td></tr>').join('')}async function create(){let r=await fetch('/admin/codes',{method:'POST',headers:h(),body:JSON.stringify({days:+days.value})}),x=await r.json();newcode.textContent=x.code||JSON.stringify(x);load()}async function toggle(c){await fetch('/admin/codes/toggle',{method:'POST',headers:h(),body:JSON.stringify({code:c})});load()}async function settings(){await fetch('/admin/settings',{method:'POST',headers:h(),body:JSON.stringify({katu:katu.value,xllm:xllm.value})});katu.value=xllm.value='';alert('已保存')}</script>`;
http
  .createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return send(res, 204, {});
      const u = new URL(req.url, "http://x"),
        d = load();
      if (u.pathname === "/health")
        return send(res, 200, { ok: true, name: "瑞滢AI Gateway" });
      if (u.pathname === "/api/app-update") {
        const file = "/opt/ruiying/update.json";
        const update = fs.existsSync(file)
          ? JSON.parse(fs.readFileSync(file, "utf8"))
          : { version: "0.0.0" };
        return send(res, 200, update);
      }
      if (u.pathname === "/downloads/ruiying-ai-setup.exe") {
        const file = "/opt/ruiying/downloads/ruiying-ai-setup.exe";
        if (!fs.existsSync(file))
          return send(res, 404, { error: "安装包尚未上传" });
        const stat = fs.statSync(file);
        res.writeHead(200, {
          "content-type": "application/vnd.microsoft.portable-executable",
          "content-length": stat.size,
          "content-disposition": 'attachment; filename="RuiyingAI-Setup.exe"',
          "cache-control": "no-store",
        });
        return fs.createReadStream(file).pipe(res);
      }
      if (/^\/downloads\/ruiying-ai-patch-[0-9.]+\.tar\.gz$/.test(u.pathname)) {
        const filename = u.pathname.split("/").pop();
        const file = `/opt/ruiying/downloads/${filename}`;
        if (!fs.existsSync(file)) return send(res, 404, { error: "补丁包尚未上传" });
        const stat = fs.statSync(file);
        res.writeHead(200, {
          "content-type": "application/gzip",
          "content-length": stat.size,
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        });
        return fs.createReadStream(file).pipe(res);
      }
      if (u.pathname === "/admin-points.js")
        return send(
          res,
          200,
          fs.readFileSync("/opt/ruiying/admin-points.js", "utf8"),
          "application/javascript; charset=utf-8",
        );
      if (u.pathname === "/admin") {
        const extra = `<style>.provider-model-panel{margin:20px 0;padding:20px;border:1px solid #26354d;border-radius:14px;background:#091725;color:#eef6ff}.provider-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}.provider-card{padding:16px;border:1px solid #26354d;border-radius:12px;background:#0d1d2d}.provider-card h3{margin:0 0 12px}.provider-card input,.provider-card select{width:100%;box-sizing:border-box;margin:6px 0;padding:10px}.provider-actions{display:flex;gap:8px;align-items:center}.provider-model-list{max-height:220px;overflow:auto;margin-top:10px;font-size:12px}.provider-model-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid #203247}.provider-price{color:#62e6c5;text-align:right;white-space:pre-wrap}</style><script>window.addEventListener('DOMContentLoaded',()=>{const h=()=>({'content-type':'application/json','x-admin-username':document.getElementById('username').value.trim(),'x-admin-password':document.getElementById('password').value});const esc=x=>String(x??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));const panel=document.createElement('section');panel.className='provider-model-panel';panel.innerHTML='<h2>生图 API 平台与模型</h2><p>分别配置平台密钥，同步实时模型名称和价格，再选择客户端使用的模型。</p><div id="providerGrid" class="provider-grid"></div>';document.body.appendChild(panel);async function loadProviders(){const r=await fetch('/admin/settings',{headers:h()});if(!r.ok)return;const d=await r.json(),grid=document.getElementById('providerGrid');grid.innerHTML=Object.entries(d.providers||{}).map(([id,p])=>{const rows=(p.models||[]).map(m=>'<div class="provider-model-row"><span>'+esc(m.name)+'<br><small>'+esc(m.id)+'</small></span><span class="provider-price">'+esc(m.pricing?JSON.stringify(m.pricing):'价格未返回')+'</span></div>').join('');const options=(p.models||[]).map(m=>'<option value="'+esc(m.id)+'" '+(m.id===p.selected_model?'selected':'')+'>'+esc(m.name)+'</option>').join('');return '<div class="provider-card" data-provider="'+id+'"><h3>'+esc(p.name)+' '+(p.configured?'✅':'⚠️')+'</h3><input class="provider-key" type="password" placeholder="'+(p.configured?'API Key 已配置，留空不修改':'请输入 API Key')+'"><div class="provider-actions"><button class="sync-provider" type="button">同步模型与价格</button><small>'+(p.synced_at?'同步于 '+new Date(p.synced_at).toLocaleString():'尚未同步')+'</small></div><select class="provider-model"><option value="">请选择模型</option>'+options+'</select><button class="save-provider" type="button">保存所选模型</button><div class="provider-model-list">'+(rows||'<p>配置密钥后点击同步。</p>')+'</div></div>'}).join('')}panel.addEventListener('click',async e=>{const card=e.target.closest('.provider-card');if(!card)return;const provider=card.dataset.provider,key=card.querySelector('.provider-key').value.trim();if(e.target.closest('.sync-provider')){e.target.disabled=true;try{if(key)await fetch('/admin/settings',{method:'POST',headers:h(),body:JSON.stringify({[provider]:key})});const r=await fetch('/admin/providers/sync',{method:'POST',headers:h(),body:JSON.stringify({provider})}),d=await r.json();if(!r.ok)throw Error(d.error||'同步失败');card.querySelector('.provider-key').value='';await loadProviders()}catch(err){alert(err.message)}finally{e.target.disabled=false}}if(e.target.closest('.save-provider')){const model=card.querySelector('.provider-model').value;if(!model)return alert('请先选择模型');await fetch('/admin/settings',{method:'POST',headers:h(),body:JSON.stringify({provider_models:{[provider]:model}})});alert('已保存')}});document.getElementById('loginButton')?.addEventListener('click',()=>setTimeout(loadProviders,500));loadProviders().catch(()=>{})});</script>`;
        const adminPanel = `<style>.provider-model-panel.panel{grid-column:auto;margin:0;padding:24px;background:#fff;color:#172033;border:1px solid #e7edf5;border-radius:12px}.provider-model-panel h2{font-size:18px;margin:0 0 4px}.provider-intro{color:#8290a5;margin:0 0 18px}.planner-key{padding:14px;background:#f8fafc;border:1px solid #e7edf5;border-radius:10px;margin-bottom:14px}.planner-key label{display:block;font-weight:700;margin-bottom:7px}.planner-row{display:flex;gap:8px}.planner-row input{flex:1;min-width:0;height:42px;padding:0 12px;border:1px solid #dbe3ee;border-radius:8px}.provider-grid{grid-template-columns:1fr;gap:12px}.provider-card{padding:15px;border-color:#e4ebf4;background:#fbfdff}.provider-card h3{display:flex;align-items:center;justify-content:space-between}.provider-card input,.provider-card select{height:42px;border:1px solid #dbe3ee;border-radius:8px;background:#fff}.provider-card button{border:0;border-radius:8px;padding:9px 13px;background:#258ee8;color:#fff;font-weight:600;cursor:pointer}.provider-actions small{color:#8290a5}.provider-model-list{border:1px solid #edf1f6;border-radius:8px;padding:0 10px;background:#fff}.provider-model-row{border-color:#edf1f6}.provider-price{color:#168b68;max-width:48%;overflow-wrap:anywhere}.provider-status{font-size:12px;padding:3px 8px;border-radius:999px;background:#eaf8f1;color:#138357}</style><script>window.addEventListener('DOMContentLoaded',()=>{const panel=document.querySelector('.provider-model-panel'),old=document.getElementById('katu')?.closest('.panel');if(!panel||!old)return;panel.classList.add('panel');panel.querySelector('h2').textContent='API 与模型配置';panel.querySelector('p').className='provider-intro';panel.querySelector('p').textContent='密钥、模型与价格由管理员统一管理，用户端只显示已选模型。';panel.querySelector('p').insertAdjacentHTML('afterend','<div class="planner-key"><label>AI 分析模型 · X-LLM API Key</label><div class="planner-row"><input id="xllmUnified" type="password" placeholder="留空表示不修改"><button id="savePlannerKey" type="button">保存</button></div></div>');old.before(panel);old.remove();document.getElementById('savePlannerKey').addEventListener('click',async e=>{const key=document.getElementById('xllmUnified').value.trim();if(!key)return;const headers={'content-type':'application/json','x-admin-username':document.getElementById('username').value.trim(),'x-admin-password':document.getElementById('password').value};e.target.disabled=true;try{const r=await fetch('/admin/settings',{method:'POST',headers,body:JSON.stringify({xllm:key})});if(!r.ok)throw Error('保存失败');document.getElementById('xllmUnified').value='';alert('X-LLM API Key 已保存')}catch(err){alert(err.message)}finally{e.target.disabled=false}})});</script>`;
        const roleSelector = `<style>.active-model-box{padding:16px;margin-bottom:16px;border:1px solid #dfe7f2;border-radius:12px;background:linear-gradient(135deg,#f7f5ff,#f5fbff)}.active-model-box h3{margin:0 0 5px}.active-model-box p{margin:0 0 14px;color:#718096}.active-model-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.active-model-field label{display:block;font-weight:700;margin-bottom:6px}.active-model-field select{width:100%;height:43px;border:1px solid #d8e1ed;border-radius:8px;background:#fff;padding:0 10px}.active-model-save{margin-top:13px;border:0;border-radius:8px;padding:10px 18px;background:#6d4aff;color:#fff;font-weight:700;cursor:pointer}@media(max-width:760px){.active-model-grid{grid-template-columns:1fr}}</style><script>window.addEventListener('DOMContentLoaded',()=>{const host=document.querySelector('.provider-model-panel');if(!host)return;const box=document.createElement('div');box.className='active-model-box';box.innerHTML='<h3>用户端启用模型</h3><p>各平台可继续接入和同步很多模型，但用户端最终只使用这里指定的一个生图模型和一个 AI 分析模型。</p><div class="active-model-grid"><div class="active-model-field"><label>当前生图模型</label><select id="activeImageModel"></select></div><div class="active-model-field"><label>当前 AI 分析（语言）模型</label><select id="activeLanguageModel"></select></div></div><button id="saveActiveModels" class="active-model-save" type="button">保存并应用到用户端</button>';host.querySelector('.provider-intro')?.insertAdjacentElement('afterend',box);const headers=()=>({'content-type':'application/json','x-admin-username':document.getElementById('username').value.trim(),'x-admin-password':document.getElementById('password').value}),esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));async function refreshActive(){const r=await fetch('/admin/settings',{headers:headers()});if(!r.ok)return;const d=await r.json(),images=[],languages=[];Object.entries(d.providers||{}).forEach(([id,p])=>{if(!p.configured)return;(p.image_models||[]).forEach(m=>images.push({value:id+'::'+m.id,label:p.name+' · '+m.name}));(p.language_models||[]).forEach(m=>languages.push({value:id+'::'+m.id,label:p.name+' · '+m.name}))});if(d.active_language_provider==='xllm'||!languages.length)languages.unshift({value:'xllm::'+(d.active_language_model||'gpt-5.6-terra'),label:'X-LLM · '+(d.active_language_model||'gpt-5.6-terra')});const activeImage=d.active_image_provider+'::'+(d.providers?.[d.active_image_provider]?.selected_model||''),activeLanguage=d.active_language_provider+'::'+(d.active_language_provider==='xllm'?d.active_language_model:(d.providers?.[d.active_language_provider]?.selected_language_model||d.active_language_model||''));activeImageModel.innerHTML=images.map(m=>'<option value="'+esc(m.value)+'" '+(m.value===activeImage?'selected':'')+'>'+esc(m.label)+'</option>').join('')||'<option value="">请先配置并同步图片模型</option>';activeLanguageModel.innerHTML=languages.map(m=>'<option value="'+esc(m.value)+'" '+(m.value===activeLanguage?'selected':'')+'>'+esc(m.label)+'</option>').join('')||'<option value="">请先配置并同步语言模型</option>'}saveActiveModels.addEventListener('click',async()=>{const [ip,im]=activeImageModel.value.split('::'),[lp,lm]=activeLanguageModel.value.split('::');if(!ip||!im||!lp||!lm)return alert('请先选择两个启用模型');saveActiveModels.disabled=true;try{const body={active_image_provider:ip,provider_models:{[ip]:im},active_language_provider:lp,active_language_model:lm,language_provider_models:lp==='xllm'?{}:{[lp]:lm}},r=await fetch('/admin/settings',{method:'POST',headers:headers(),body:JSON.stringify(body)});if(!r.ok)throw Error('保存失败');alert('已应用：用户端现在只会使用这两个模型')}catch(e){alert(e.message)}finally{saveActiveModels.disabled=false}});document.getElementById('loginButton')?.addEventListener('click',()=>setTimeout(refreshActive,650));host.addEventListener('click',e=>{if(e.target.closest('.sync-provider'))setTimeout(refreshActive,1400)});refreshActive().catch(()=>{})});</script>`;
        const collectionStats = `<script>window.addEventListener('DOMContentLoaded',()=>{const refresh=async()=>{const h={'x-admin-username':document.getElementById('username').value.trim(),'x-admin-password':document.getElementById('password').value},q=new URLSearchParams({from:document.getElementById('usageFrom').value,to:document.getElementById('usageTo').value}),code=document.getElementById('usageCode').value;if(code)q.set('code',code);const r=await fetch('/admin/usage?'+q,{headers:h});if(!r.ok)return;const d=await r.json(),safe=v=>String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));document.getElementById('usageCollections').textContent=d.summary.collections||0;document.getElementById('usageCodeRows').innerHTML=d.by_code.length?d.by_code.map(x=>'<tr><td><b>'+safe(x.code)+'</b></td><td>'+safe(x.note||'—')+'</td><td><b>'+(x.collections||0)+'</b></td><td>'+x.calls+'</td><td>'+x.plans+'</td><td>'+x.images+'</td><td>'+x.failed+'</td></tr>').join(''):'<tr><td colspan="7">暂无数据</td></tr>'};document.getElementById('loadUsage').addEventListener('click',()=>setTimeout(refresh,120));document.getElementById('loginButton').addEventListener('click',()=>setTimeout(refresh,900))});</script>`;
        return send(
          res,
          200,
          fs
            .readFileSync("/opt/ruiying/admin.html", "utf8")
            .replace(
              "</body>",
              extra + adminPanel + roleSelector + collectionStats + '<script src="/admin-points.js"></script></body>',
            ),
          "text/html; charset=utf-8",
        );
      }
      if (u.pathname.startsWith("/admin/") && !admin(req))
        return send(res, 401, { error: "unauthorized" });
      if (u.pathname === "/admin/codes" && req.method === "GET")
        return send(
          res,
          200,
          Object.entries(d.codes).map(([code, v]) => ({ code, ...v })),
        );
      if (u.pathname === "/admin/codes" && req.method === "POST") {
        const x = await body(req),
          code = "RYAI-" + crypto.randomBytes(4).toString("hex").toUpperCase();
        d.codes[code] = {
          active: true,
          device: null,
          note: String(x.note || "").slice(0, 120),
          credits: Math.max(0, Math.floor(Number(x.credits) || 0)),
          created_at: Date.now(),
          expires_at: Date.now() + (x.days || 365) * 864e5,
        };
        save(d);
        return send(res, 200, { code, credits: d.codes[code].credits });
      }
      if (u.pathname === "/admin/codes/toggle") {
        const x = await body(req);
        if (d.codes[x.code]) d.codes[x.code].active = !d.codes[x.code].active;
        save(d);
        return send(res, 200, { ok: true });
      }
      if (u.pathname === "/admin/codes/note") {
        const x = await body(req);
        if (!d.codes[x.code]) return send(res, 404, { error: "激活码不存在" });
        d.codes[x.code].note = String(x.note || "").slice(0, 120);
        save(d);
        return send(res, 200, { ok: true });
      }
      if (u.pathname === "/admin/codes/credit" && req.method === "POST") {
        const x = await body(req),
          current = load(),
          amount = Math.floor(Number(x.amount) || 0),
          c = current.codes[x.code];
        if (!c) return send(res, 404, { error: "激活码不存在" });
        if (amount <= 0 || amount > 1000000)
          return send(res, 400, {
            error: "充值积分必须是 1 到 1000000 的整数",
          });
        c.credits = Math.max(0, Math.floor(Number(c.credits) || 0)) + amount;
        current.credit_logs = Array.isArray(current.credit_logs)
          ? current.credit_logs
          : [];
        current.credit_logs.push({
          ts: Date.now(),
          code: x.code,
          type: "recharge",
          amount,
          balance: c.credits,
        });
        save(current);
        return send(res, 200, { ok: true, credits: c.credits });
      }
      if (u.pathname === "/admin/credits/summary") {
        const from = Date.parse(
            (u.searchParams.get("from") || "1970-01-01") + "T00:00:00+08:00",
          ),
          to = Date.parse(
            (u.searchParams.get("to") || "2999-12-31") + "T23:59:59.999+08:00",
          ),
          selected = u.searchParams.get("code") || "",
          logs = (Array.isArray(d.credit_logs) ? d.credit_logs : []).filter(
            (x) =>
              x.ts >= from && x.ts <= to && (!selected || x.code === selected),
          ),
          rows = Object.entries(d.codes)
            .filter(([code]) => !selected || code === selected)
            .map(([code, c]) => {
              const own = logs.filter((x) => x.code === code),
                recharged = own
                  .filter((x) => x.type === "recharge")
                  .reduce((n, x) => n + Math.max(0, Number(x.amount) || 0), 0),
                consumed = Math.abs(
                  own
                    .filter((x) => x.type === "consume_batch")
                    .reduce((n, x) => n + (Number(x.amount) || 0), 0),
                ),
                refunded = own
                  .filter((x) => x.type === "refund_batch")
                  .reduce((n, x) => n + Math.max(0, Number(x.amount) || 0), 0);
              return {
                code,
                note: c.note || "",
                active: !!c.active,
                balance: Math.max(0, Math.floor(Number(c.credits) || 0)),
                recharged,
                consumed,
                refunded,
                net_consumed: Math.max(0, consumed - refunded),
                batches: own.filter((x) => x.type === "consume_batch").length,
              };
            });
        return send(res, 200, {
          summary: {
            balance: rows.reduce((n, x) => n + x.balance, 0),
            recharged: rows.reduce((n, x) => n + x.recharged, 0),
            consumed: rows.reduce((n, x) => n + x.consumed, 0),
            refunded: rows.reduce((n, x) => n + x.refunded, 0),
            net_consumed: rows.reduce((n, x) => n + x.net_consumed, 0),
            batches: rows.reduce((n, x) => n + x.batches, 0),
          },
          by_code: rows.sort((a, b) => b.net_consumed - a.net_consumed),
        });
      }
      if (u.pathname === "/admin/usage") {
        const from = Date.parse(
            (u.searchParams.get("from") || "1970-01-01") + "T00:00:00+08:00",
          ),
          to = Date.parse(
            (u.searchParams.get("to") || "2999-12-31") + "T23:59:59.999+08:00",
          ),
          code = u.searchParams.get("code") || "";
        const logs = (Array.isArray(d.logs) ? d.logs : []).filter(
          (x) => x.ts >= from && x.ts <= to && (!code || x.code === code),
        );
        const daily = {},
          byCode = {};
        for (const x of logs) {
          const day = new Date(x.ts + 8 * 3600e3).toISOString().slice(0, 10);
          daily[day] ??= {
            date: day,
            calls: 0,
            plans: 0,
            images: 0,
            collections: 0,
            failed: 0,
          };
          byCode[x.code] ??= {
            code: x.code,
            note: d.codes[x.code]?.note || "",
            calls: 0,
            plans: 0,
            images: 0,
            collections: 0,
            failed: 0,
          };
          for (const row of [daily[day], byCode[x.code]]) {
            row.calls++;
            row.plans += x.type === "plan" ? 1 : 0;
            row.images += Number(x.images) || 0;
            row.collections += Number(x.collections) || (x.type === "collection" ? 1 : 0);
            row.failed += Number(x.status) >= 400 ? 1 : 0;
          }
        }
        return send(res, 200, {
          summary: {
            calls: logs.length,
            plans: logs.filter((x) => x.type === "plan").length,
            images: logs.reduce((n, x) => n + (Number(x.images) || 0), 0),
            collections: logs.reduce((n, x) => n + (Number(x.collections) || (x.type === "collection" ? 1 : 0)), 0),
            failed: logs.filter((x) => Number(x.status) >= 400).length,
          },
          daily: Object.values(daily).sort((a, b) =>
            a.date.localeCompare(b.date),
          ),
          by_code: Object.values(byCode).sort((a, b) => b.images - a.images),
        });
      }
      if (u.pathname === "/admin/settings" && req.method === "GET")
        return send(res, 200, {
          image_model: d.settings.image_model || "gpt-image-2.5-sunburst",
          active_image_provider: d.settings.active_image_provider || "katu",
          active_language_provider: d.settings.active_language_provider || (d.settings.xllm ? "xllm" : ""),
          active_language_model: d.settings.active_language_model || (d.settings.xllm ? "gpt-5.6-terra" : ""),
          teamo_configured: !!d.settings.teamo,
          providers: Object.fromEntries(Object.entries(providerDefinitions).map(([id, definition]) => [id, {
            name: definition.name,
            configured: !!d.settings[id],
            selected_model: d.settings.provider_models?.[id] || (id === "katu" ? d.settings.image_model || "gpt-image-2.5-sunburst" : ""),
            selected_language_model: d.settings.language_provider_models?.[id] || "",
            models: d.settings.model_catalogs?.[id]?.models || [],
            image_models: (d.settings.model_catalogs?.[id]?.models || []).filter((model) => (model.kind || modelKind(model.id, model.name)) === "image"),
            language_models: (d.settings.model_catalogs?.[id]?.models || []).filter((model) => (model.kind || modelKind(model.id, model.name)) === "language"),
            synced_at: d.settings.model_catalogs?.[id]?.synced_at || 0,
          }])),
        });
      if (u.pathname === "/admin/settings" && req.method === "POST") {
        const x = await body(req),
          current = load();
        current.settings = current.settings || {};
        for (const provider of Object.keys(providerDefinitions))
          if (x[provider]) current.settings[provider] = String(x[provider]).trim();
        if (x.xllm) current.settings.xllm = x.xllm;
        if (x.image_model)
          current.settings.image_model = String(x.image_model).slice(0, 100);
        if (providerDefinitions[x.active_image_provider]) current.settings.active_image_provider = x.active_image_provider;
        if (x.active_language_provider === "xllm" || providerDefinitions[x.active_language_provider]) current.settings.active_language_provider = x.active_language_provider;
        if (x.active_language_model) current.settings.active_language_model = String(x.active_language_model).slice(0, 120);
        current.settings.provider_models = current.settings.provider_models || {};
        current.settings.language_provider_models = current.settings.language_provider_models || {};
        if (x.provider_models && typeof x.provider_models === "object")
          for (const provider of Object.keys(providerDefinitions))
            if (x.provider_models[provider]) current.settings.provider_models[provider] = String(x.provider_models[provider]).slice(0, 120);
        if (x.language_provider_models && typeof x.language_provider_models === "object")
          for (const provider of Object.keys(providerDefinitions))
            if (x.language_provider_models[provider]) current.settings.language_provider_models[provider] = String(x.language_provider_models[provider]).slice(0, 120);
        save(current);
        return send(res, 200, {
          ok: true,
          image_model: current.settings.image_model || "gpt-image-2.5-sunburst",
          teamo_configured: !!current.settings.teamo,
        });
      }
      if (u.pathname === "/admin/providers/sync" && req.method === "POST") {
        const x = await body(req), provider = String(x.provider || ""), current = load();
        if (!providerDefinitions[provider]) return send(res, 400, { error: "不支持的 API 平台" });
        try {
          const models = await syncProviderModels(provider, current.settings?.[provider]);
          current.settings.model_catalogs = current.settings.model_catalogs || {};
          current.settings.provider_models = current.settings.provider_models || {};
          current.settings.language_provider_models = current.settings.language_provider_models || {};
          current.settings.model_catalogs[provider] = { models, synced_at: Date.now() };
          const imageModels = models.filter((model) => model.kind === "image"), languageModels = models.filter((model) => model.kind === "language");
          if (imageModels.length && (!current.settings.provider_models[provider] || !imageModels.some((model) => model.id === current.settings.provider_models[provider]))) current.settings.provider_models[provider] = imageModels[0].id;
          if (languageModels.length && (!current.settings.language_provider_models[provider] || !languageModels.some((model) => model.id === current.settings.language_provider_models[provider]))) current.settings.language_provider_models[provider] = languageModels[0].id;
          save(current);
          return send(res, 200, { provider, name: providerDefinitions[provider].name, models, selected_model: current.settings.provider_models[provider], synced_at: current.settings.model_catalogs[provider].synced_at });
        } catch (error) { return send(res, 502, { error: error.message }); }
      }
      if (u.pathname === "/api/activate") {
        const x = await body(req),
          c = d.codes[x.code];
        if (!c || !c.active || Date.now() > c.expires_at)
          return send(res, 403, { error: "激活码无效或已到期" });
        if (c.device && c.device !== x.device)
          return send(res, 403, { error: "激活码已绑定其他设备" });
        c.device = x.device;
        c.credits = Math.max(0, Math.floor(Number(c.credits) || 0));
        const logs = (Array.isArray(d.credit_logs) ? d.credit_logs : []).filter(
            (v) => v.code === x.code,
          ),
          credit_summary = {
            recharged: logs
              .filter((v) => v.type === "recharge")
              .reduce((n, v) => n + Math.max(0, Number(v.amount) || 0), 0),
            consumed: Math.abs(
              logs
                .filter((v) => v.type === "consume_batch")
                .reduce((n, v) => n + (Number(v.amount) || 0), 0),
            ),
            refunded: logs
              .filter((v) => v.type === "refund_batch")
              .reduce((n, v) => n + Math.max(0, Number(v.amount) || 0), 0),
          };
        const t = token();
        d.tokens[hash(t)] = {
          code: x.code,
          device: x.device,
          expires_at: c.expires_at,
        };
        save(d);
        return send(res, 200, {
          token: t,
          expires_at: c.expires_at,
          credits: c.credits,
          nickname: String(c.note || "")
            .trim()
            .slice(0, 40),
          credit_summary,
        });
      }
      const who = auth(req);
      if (!who)
        return send(res, 401, { error: "激活码已停用、失效或登录已过期" });
      const usage = { db: d, code: who.code };
      if (u.pathname === "/api/session") {
        const current = load(),
          c = current.codes[who.code] || {};
        return send(res, 200, {
          ok: true,
          code: who.code,
          expires_at: who.expires_at,
          credits: Math.max(0, Math.floor(Number(c.credits) || 0)),
        });
      }
      if (u.pathname === "/api/collection-event" && req.method === "POST") {
        const x = await body(req), count = Math.max(1, Math.min(30, Number(x.count) || 1));
        record(d, who.code, "collection", 0, 200, { collections: count });
        return send(res, 200, { ok: true, collections: count });
      }
      if (u.pathname === "/api/preflight") {
        if (!d.settings.katu)
          return send(res, 503, {
            error: { message: "管理员尚未配置生图 API" },
          });
        try {
          const check = await fetch("https://www.katuai.cn/v1/models", {
            headers: { authorization: `Bearer ${d.settings.katu}` },
          });
          if (!check.ok)
            return send(res, 503, {
              error: { message: `咖图服务检查失败（${check.status}）` },
            });
          return send(res, 200, { ok: true });
        } catch (error) {
          return send(res, 503, {
            error: { message: `咖图服务暂时不可用：${error.message}` },
          });
        }
      }
      if (u.pathname === "/api/credits/history") {
        const current = load(),
          rows = (Array.isArray(current.credit_logs) ? current.credit_logs : [])
            .filter((x) => x.code === who.code)
            .slice(-100)
            .reverse();
        return send(res, 200, {
          credits: Math.max(
            0,
            Math.floor(Number(current.codes[who.code]?.credits) || 0),
          ),
          rows,
        });
      }
      if (u.pathname === "/api/batches/charge" && req.method === "POST") {
        const x = await body(req),
          batchId = String(x.batch_id || "").slice(0, 100);
        if (!batchId)
          return send(res, 400, { error: { message: "缺少批次编号" } });
        const current = load(),
          c = current.codes[who.code],
          cost = 10,
          key = `${who.code}:${batchId}`;
        if (!c || !c.active)
          return send(res, 401, { error: "激活码已停用或失效" });
        c.credits = Math.max(0, Math.floor(Number(c.credits) || 0));
        current.batch_charges =
          current.batch_charges && typeof current.batch_charges === "object"
            ? current.batch_charges
            : {};
        if (current.batch_charges[key])
          return send(res, 200, {
            ok: true,
            cost,
            credits: c.credits,
            duplicate: true,
            refunded: !!current.batch_charges[key].refunded,
          });
        if (c.credits < cost)
          return send(res, 402, {
            error: {
              message: `积分不足：生成一组九图需要 ${cost} 积分，当前剩余 ${c.credits} 积分`,
            },
            credits: c.credits,
            cost,
          });
        c.credits -= cost;
        current.batch_charges[key] = {
          ts: Date.now(),
          cost,
          balance: c.credits,
          refunded: false,
        };
        const chargeKeys = Object.keys(current.batch_charges);
        if (chargeKeys.length > 10000)
          for (const oldKey of chargeKeys
            .sort(
              (a, b) =>
                current.batch_charges[a].ts - current.batch_charges[b].ts,
            )
            .slice(0, chargeKeys.length - 10000))
            delete current.batch_charges[oldKey];
        current.credit_logs = Array.isArray(current.credit_logs)
          ? current.credit_logs
          : [];
        current.credit_logs.push({
          ts: Date.now(),
          code: who.code,
          type: "consume_batch",
          batch_id: batchId,
          amount: -cost,
          balance: c.credits,
        });
        save(current);
        return send(res, 200, { ok: true, cost, credits: c.credits });
      }
      if (u.pathname === "/api/batches/refund" && req.method === "POST") {
        const x = await body(req),
          batchId = String(x.batch_id || "").slice(0, 100),
          current = load(),
          key = `${who.code}:${batchId}`,
          charge = current.batch_charges?.[key],
          c = current.codes[who.code];
        if (!charge)
          return send(res, 404, { error: { message: "未找到该批次扣费记录" } });
        if (charge.refunded)
          return send(res, 200, {
            ok: true,
            duplicate: true,
            credits: c.credits,
          });
        const amount = Math.max(0, Math.floor(Number(charge.cost) || 10));
        c.credits = Math.max(0, Math.floor(Number(c.credits) || 0)) + amount;
        charge.refunded = true;
        charge.refunded_at = Date.now();
        current.credit_logs = Array.isArray(current.credit_logs)
          ? current.credit_logs
          : [];
        current.credit_logs.push({
          ts: Date.now(),
          code: who.code,
          type: "refund_batch",
          batch_id: batchId,
          amount,
          balance: c.credits,
        });
        save(current);
        return send(res, 200, { ok: true, amount, credits: c.credits });
      }
      if (u.pathname === "/api/config")
        return send(res, 200, (() => {
          const providerModels = d.settings.provider_models || {};
          const provider = providerDefinitions[d.settings.active_image_provider] && d.settings[d.settings.active_image_provider] ? d.settings.active_image_provider : Object.keys(providerDefinitions).find((id) => d.settings[id]) || "katu";
          const model = providerModels[provider] || (provider === "katu" ? d.settings.image_model || "gpt-image-2.5-sunburst" : "");
          const catalog = d.settings.model_catalogs?.[provider]?.models || [], detail = catalog.find((item) => item.id === model), definition = providerDefinitions[provider];
          const imageModels = model && d.settings[provider] ? [{ value: `${provider}:${model}`, label: `${definition.name} · ${detail?.name || model}`, provider, model, pricing: detail?.pricing || null }] : [];
          return { image_model: model, image_models: imageModels };
        })());
      if (u.pathname === "/api/models")
        return proxy(
          req,
          res,
          "https://www.katuai.cn/v1/models",
          d.settings.katu,
        );
      if (u.pathname === "/api/plan" && req.method === "POST")
        return (() => {
          const provider = d.settings.active_language_provider;
          const definition = providerDefinitions[provider];
          const useProvider = definition?.chatUrl && d.settings[provider] && d.settings.active_language_model;
          return createPlan(req, res, useProvider ? { key: d.settings[provider], url: definition.chatUrl, model: d.settings.active_language_model } : { key: d.settings.xllm, url: "https://x-llm.net/v1/chat/completions", model: d.settings.active_language_model || "gpt-5.6-terra" }, usage);
        })();
      if (u.pathname === "/api/generate") {
        const requestedModel = String(req.headers["x-image-model"] || "");
        const activeProvider = d.settings.active_image_provider;
        const provider = providerDefinitions[activeProvider] && d.settings[activeProvider] ? activeProvider : Object.keys(providerDefinitions).find((id) => d.settings[id]) || "katu";
        const definition = providerDefinitions[provider];
        const model = (d.settings.provider_models?.[provider] || (provider === "katu" ? d.settings.image_model : "") || requestedModel.replace(/^[a-z0-9_-]+:/i, "") || "gpt-image-2.5-sunburst").slice(0, 120);
        if (!d.settings[provider])
          return send(res, 503, { error: { message: `管理员尚未配置${definition.name} API Key`, billing_status: "not_accepted" } });
        if (definition.mode === "openai") return queueOpenAiImageGenerate(req, res, d.settings[provider], { ...usage, model }, provider);
        return proxy(
          req,
          res,
          `${definition.imageBase}/images/generations`,
          d.settings[provider],
          { ...usage, type: "generate", model },
        );
      }
      if (u.pathname.startsWith("/api/tasks/") && req.method === "GET") {
        const rawId = decodeURIComponent(u.pathname.slice("/api/tasks/".length));
        const localJob = gatewayImageJobs.get(rawId);
        if (localJob) return send(res, 200, localJob);
        const id = encodeURIComponent(rawId);
        return proxy(
          req,
          res,
          "https://www.katuai.cn/v1/images/tasks/" + id,
          d.settings.katu,
        );
      }
      if (u.pathname === "/api/history")
        return proxy(
          req,
          res,
          "https://www.katuai.cn/v1/images/history" + u.search,
          d.settings.katu,
          { ...usage, type: "history" },
        );
      return send(res, 404, { error: "not found" });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log("ruiying gateway 8787"));
