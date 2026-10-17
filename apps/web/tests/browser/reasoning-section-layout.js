/**
 * @file reasoning-section-layout.js
 * @description Browser regression check for clipped AI progress card shadows.
 * Run with the web dev server on :3001, using Playwright browser_run_code_unsafe
 * with this file's absolute path as filename. Uses real CSS and layout because
 * jsdom cannot measure clipping. The temporary component is removed afterward.
 */
async (page) => {
  await page.goto("http://127.0.0.1:3001");
  const fixture = await page.evaluateHandle(async () => {
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ReasoningSection } = await import("/src/app/sqllab/components/ai/ReasoningSection.tsx");
    const host = document.createElement("div");
    host.id = "reasoning-layout-check";
    host.style.cssText = "position:fixed;inset:0;z-index:99999;padding:24px;background:var(--background);overflow:auto";
    const style = document.createElement("style");
    style.textContent = "#reasoning-layout-check * { animation: none !important; transition: none !important; }";
    host.append(style);
    const mount = document.createElement("div");
    host.append(mount);
    document.body.append(host);
    const root = ReactDOM.createRoot(mount);
    return {
      render({ dark, streaming, expanded, count, multiline }) {
        host.classList.toggle("dark", dark);
        const content = multiline ? "Đang tạo SQL...\n\nĐang kiểm tra truy vấn an toàn." : "Đang tạo SQL...";
        const steps = Array.from({ length: count }, (_, i) => ({
          type: "thinking",
          content: i === count - 1 ? content : `Bước ${i + 1}`,
          status: streaming && i === count - 1 ? "active" : "complete",
        }));
        root.render(React.createElement(ReasoningSection, {
          steps, showThought: expanded, onToggle() {}, isDark: dark, isGeneratingSQL: streaming,
        }));
      },
      cleanup() { root.unmount(); host.remove(); },
    };
  });
  const results = [];
  try {
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const dark of [false, true]) {
        for (const streaming of [true, false]) {
          for (const count of [1, 5]) {
            await fixture.evaluate((api, options) => api.render(options), {
              dark, streaming, expanded: true, count, multiline: width === 360,
            });
            await page.waitForFunction(({ count, streaming }) => {
              const host = document.getElementById("reasoning-layout-check");
              return host.querySelectorAll(".prose").length === count &&
                Boolean(host.textContent.includes("Phân tích hoàn tất")) === !streaming;
            }, { count, streaming });
            const clearance = await page.evaluate(() => {
              const host = document.getElementById("reasoning-layout-check");
              const clip = host.querySelector(".grid").getBoundingClientRect();
              const cards = [...host.querySelectorAll(".prose")].map((card) => card.getBoundingClientRect());
              return {
                bottom: clip.bottom - cards.at(-1).bottom,
                right: Math.min(...cards.map((card) => clip.right - card.right)),
                top: Math.min(...cards.map((card) => card.top - clip.top)),
                overflow: host.scrollWidth > host.clientWidth,
              };
            });
            if (clearance.bottom < 3.9 || clearance.right < 3.9 || clearance.top < 0 || clearance.overflow) {
              throw new Error(`Progress clipping at ${JSON.stringify({ width, dark, streaming, count, ...clearance })}`);
            }
            results.push({ width, dark, streaming, count, ...clearance });
          }
        }
      }
    }
    await fixture.evaluate((api) => api.render({ dark: false, streaming: true, expanded: false, count: 5 }));
    await page.waitForFunction(() => document.querySelector("#reasoning-layout-check .grid")?.getBoundingClientRect().height === 0);
    return { passed: results.length, collapsedHeight: 0, results };
  } finally {
    await fixture.evaluate((api) => api.cleanup());
    await fixture.dispose();
  }
}
