const base = process.env.AGENTOS_API_BASE_URL || "http://127.0.0.1:3189";
const workspace = process.env.AGENTOS_WORKSPACE || "resume_auto_fill";
const message = process.env.AGENTOS_MESSAGE || "请简单解释一下什么是二分查找，并给出伪代码";

const payload = {
  workspace_name: workspace,
  message,
  history: []
};

function parseFrames(text) {
  const frames = [];
  let buf = text;
  while (true) {
    const idx = buf.indexOf("\n\n");
    if (idx === -1) break;
    frames.push(buf.slice(0, idx));
    buf = buf.slice(idx + 2);
  }
  return { frames, rest: buf };
}

function parseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  let event = "";
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  return { event, data: dataLines.join("\n") };
}

const res = await fetch(`${base.replace(/\/+$/, "")}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});

console.log("status", res.status, res.headers.get("content-type"));
if (!res.ok) {
  console.log(await res.text());
  process.exit(1);
}
if (!res.body) {
  console.log("no body");
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const { frames, rest } = parseFrames(buffer);
  buffer = rest;
  for (const frame of frames) {
    const { event, data } = parseFrame(frame);
    if (!event) continue;
    const snippet = data.length > 200 ? `${data.slice(0, 200)}...` : data;
    console.log("EVENT", event, "DATA", snippet);
  }
}

