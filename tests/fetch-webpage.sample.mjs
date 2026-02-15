import { fetchWebpageTool } from "../dist-electron/core/tooling/web/fetch-webpage.js";

const workspaceStub = {
  name: "tool-sample",
  source_path: process.cwd(),
  mirror_path: process.cwd(),
  model: "sample"
};

const urls = [
  "https://www.volcengine.com/docs/82379/1494384?lang=zh"
];

function printError(error) {
  if (!(error instanceof Error)) {
    console.error("非 Error 异常:", error);
    return;
  }
  console.error(
    JSON.stringify(
      {
        name: error.name,
        message: error.message,
        stack: error.stack ?? ""
      },
      null,
      2
    )
  );
}

async function runOne(url) {
  console.log("\n========================================");
  console.log(`URL: ${url}`);
  console.log("========================================");
  const startedAt = Date.now();
  try {
    const result = await fetchWebpageTool.run(workspaceStub, { url, max_length: 1500 });
    const output = result;
    const content = typeof output.content === "string" ? output.content : "";
    console.log(
      JSON.stringify(
        {
          ok: true,
          durationMs: Date.now() - startedAt,
          source: output.source ?? "direct",
          directError: output.direct_error ?? "",
          fetchedUrl: output.fetched_url ?? "",
          title: output.title ?? "",
          length: output.length ?? 0,
          contentType: output.contentType ?? "",
          contentPreview: content.slice(0, 260)
        },
        null,
        2
      )
    );
  } catch (error) {
    console.log(`执行失败，耗时: ${Date.now() - startedAt}ms`);
    printError(error);
  }
}

async function main() {
  for (const url of urls) {
    await runOne(url);
  }
}

main().catch((error) => {
  console.error("样例脚本异常退出:");
  printError(error);
  process.exitCode = 1;
});
