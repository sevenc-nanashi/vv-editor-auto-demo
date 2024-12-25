import fs from "node:fs/promises";
import path from "node:path";
import playwright, { type ElementHandle, type Locator } from "playwright";
import { unlerp } from "../utils.ts";
import { appLogger } from "../log.ts";

appLogger.info("Start recording");
const compositePath = path.join(import.meta.dirname, "..", "composite");
const videosPath = path.join(compositePath, "videos");
await fs.rm(videosPath, { recursive: true, force: true });

const keyboardDelay = 100;
const actionDelay = 300;
const cellDelay = 500;

const pwLogger = appLogger.getChild("playwright");
const browser = await playwright.chromium.launch({
  headless: false,
  timeout: 5 * 60 * 1000,
  logger: {
    isEnabled(_name, severity) {
      if (severity === "verbose") {
        return false;
      }
      return true;
    },
    log(name, severity, message, args, _hints) {
      const content = [message, ...args].map(String).join(" ");
      const childLogger = pwLogger.getChild(name);
      switch (severity) {
        case "verbose":
          childLogger.debug(content);
          break;
        case "info":
          childLogger.info(content);
          break;
        case "warning":
          childLogger.warn(content);
          break;
        case "error":
          childLogger.error(content);
          break;
      }
    },
  },
});

const startTime = Date.now();

appLogger.info("Open new page");
const page = await browser.newPage({
  recordVideo: {
    dir: videosPath,
    size: {
      width: 1280,
      height: 720,
    },
  },
  viewport: { width: 1280, height: 720 },
});

await page.goto(
  // TODO: 2433がマージされたらlocalhost:5173またはmainにする
  "https://voicevox.github.io/preview-pages/preview/pr-2433/editor",
);

appLogger.info("Initializing...");
await page
  .locator("button", {
    hasText: "同意して使用開始",
  })
  .first()
  .click();
await page
  .locator("button", {
    hasText: "完了",
  })
  .first()
  .click();
await page
  .locator("button", {
    hasText: "許可",
  })
  .first()
  .click();

appLogger.info("Loading project file");
const buffer = await fs.readFile(
  path.resolve(import.meta.dirname, "demo.vvproj"),
  "utf-8",
);
// https://github.com/microsoft/playwright/issues/10667#issuecomment-998397241
const dataTransfer = await page.evaluateHandle((data) => {
  const dt = new DataTransfer();
  const bytes = new TextEncoder().encode(data);
  const file = new File([bytes], "demo.vvproj", {
    type: "application/octet-stream",
  });
  dt.items.add(file);
  return dt;
}, buffer);
await page.dispatchEvent(".audio-cell-pane", "drop", { dataTransfer });

const cursorSvg = await fs.readFile(
  path.resolve(import.meta.dirname, "cursor.svg"),
  "utf-8",
);
const cursor = await page.evaluateHandle((cursorSvg) => {
  const cursorContainer = document.createElement("div");
  document.body.appendChild(cursorContainer);
  cursorContainer.style.position = "fixed";
  cursorContainer.style.pointerEvents = "none";
  cursorContainer.innerHTML = cursorSvg;
  const cursor = cursorContainer.firstElementChild as SVGElement;
  if (!cursor) {
    throw new Error("Unreachable: Cursor not found");
  }
  cursor.id = "cursor";
  cursor.style.strokeWidth = "2px";
  cursor.style.position = "fixed";
  cursor.style.pointerEvents = "none";
  cursor.style.zIndex = "99999999";
  cursor.style.width = "32px";
  cursor.style.height = "32px";
  cursor.style.left = "10px";
  cursor.style.top = "10px";
  cursor.style.transition = "left 500ms ease-out, top 500ms ease-out";

  return cursor;
}, cursorSvg);

const moveCursorTo = async (
  locator: Locator,
  horizontalLocation: number,
  verticalLocation: number,
) => {
  appLogger.info("Moving cursor");
  await locator.first().evaluate(
    async (target, { cursor, horizontalLocation, verticalLocation }) => {
      const box = target.getBoundingClientRect();
      const x = box.left + box.width * horizontalLocation;
      const y = box.top + box.height * verticalLocation;

      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;
    },
    { cursor, horizontalLocation, verticalLocation } as const,
  );
  await page.waitForTimeout(500);
};

appLogger.info("Setting window title");
await page.evaluate(() => {
  const windowTitle = document.querySelector(".window-title");
  if (!windowTitle) {
    throw new Error("Window title not found");
  }
  windowTitle.textContent = "VOICEVOX - Ver. 0.22.1";
});

// テキストメモ：
//   - （空欄）
//   - ここに文章を入力します（キャッシュ用）
//   - 再生ボタンを押すと、文章が読まれます
//   - 読み方が変なときは、イントネーションを修正することもできます（アクセント崩壊版）
//   - 読み方が変なときは、イントネーションを修正することもできます（アクセント正常版、キャッシュ用）
//   - もっと細かく調整することもできます
//   - もっと細かく調整することもできます（イントネーション調整後、キャッシュ用）
//   - ぜひ、みなさんもダウンロードして、遊んでみてください
//   - ぜひ、みなさんもダウンロードして、遊んでみてください（キャッシュ用）
const cacheCells = [1, 4, 6, 8];
while (true) {
  const cells = await page.locator(".audio-cell").all();
  if (cells.length === 9) {
    break;
  }
  appLogger.info`Waiting for cells: ${cells.length}`;
  await page.waitForTimeout(1000);
}

appLogger.info("0: Do initial set up");
await page.locator(".audio-cell").first().click();
const playButton = page.locator(".play-button-wrapper button");

const waitForPlaying = async () => {
  appLogger.info("Waiting for playing");
  await page.waitForFunction(() => {
    const playButton = document.querySelector(
      ".play-button-wrapper button",
    ) as HTMLButtonElement | null;

    if (!playButton) {
      throw new Error("Unreachable: Play button not found");
    }
    return !playButton.disabled;
  });
};

const waitForPlayingEnd = async () => {
  const firstCellInput = page
    .locator(".audio-cell")
    .first()
    .locator("input")
    .first();
  const inputHandle = await firstCellInput.elementHandle();
  if (!inputHandle) {
    throw new Error("Unreachable: Input not found");
  }
  await page.waitForFunction(
    (input) => !input.disabled,
    inputHandle as ElementHandle<HTMLInputElement>,
  );
};

const initialAudioCells = await page.locator(".audio-cell").all();
appLogger.info("Caching audios");
for (const cell of initialAudioCells) {
  await cell.locator("input").click();
  await playButton.click();
  await waitForPlaying();
  // 停止
  await playButton.click();
}

appLogger.info("Confirming tips");
await page
  .locator(".detail-selector .q-tab", { hasText: "ｲﾝﾄﾈｰｼｮﾝ" })
  .first()
  .click();
await page
  .locator(".tip-tweakable-slider-by-scroll button", { hasText: "OK" })
  .first()
  .click();
await page
  .locator(".detail-selector .q-tab", { hasText: "ｱｸｾﾝﾄ" })
  .first()
  .click();

// キャッシュ用のAudioCellを削除
appLogger.info("Deleting cache cells");
for (const index of cacheCells.toReversed()) {
  await initialAudioCells[index].locator("input").click();
  await initialAudioCells[index]
    .locator("i", {
      hasText: "delete_outline",
    })
    .first()
    .click();
}

// 稀にaudio-cellsがスクロールされていることがあるのでリセット
appLogger.info("Resetting scroll position");
await page.evaluate(() => {
  const audioCellPane = document.querySelector(".audio-cells");
  if (!audioCellPane) {
    throw new Error("Unreachable: .audio-cells not found");
  }
  audioCellPane.scrollTo(0, 0);
});

const audioCells = await page.locator(".audio-cell").all();

const cellInput = audioCells[0].locator("input").first();
await moveCursorTo(cellInput, 0.2, 1);

await page.waitForTimeout(2500);
const loadedTime = Date.now();
appLogger.info`Loaded: took ${loadedTime - startTime}ms`;
await page.waitForTimeout(2500);

const audioTimes = [];
{
  const cellInput = audioCells[0].locator("input").first();
  appLogger.info("1: Typing new text");
  await cellInput.pressSequentially("ここに文章を入力します", {
    delay: keyboardDelay,
  });
  await page.waitForTimeout(keyboardDelay);
  await cellInput.press("Enter");
  await page.waitForTimeout(cellDelay);
}

{
  appLogger.info("2: Play");
  const cellInput = audioCells[1].locator("input").first();
  await moveCursorTo(cellInput, 0.2, 1);
  await cellInput.click();
  await page.waitForTimeout(actionDelay);
  await moveCursorTo(playButton, 0.5, 0.5);
  await playButton.click();
  await waitForPlaying();
  audioTimes.push(Date.now());
  await waitForPlayingEnd();
  await page.waitForTimeout(cellDelay);
}

{
  appLogger.info("3: Adjust accent");
  const cellInput = audioCells[2].locator("input").first();
  await moveCursorTo(cellInput, 0.2, 1);
  await cellInput.click();
  await page.waitForTimeout(actionDelay);
  await moveCursorTo(playButton, 0.5, 0.5);
  await playButton.click();
  await waitForPlaying();
  audioTimes.push(Date.now());
  await waitForPlayingEnd();
  await page.waitForTimeout(actionDelay);

  // ヨミカタガ ヘンナ トキワ、 イントネエションオ シュウセイ スル コトモ デキマス
  //                            ------^^----------
  const problematicIntonationSlider = page.locator(
    ".accent-phrase-table .mora-table:nth-child(4) .q-slider",
  );
  await moveCursorTo(problematicIntonationSlider, 3 / 8, 1);
  await page.waitForTimeout(actionDelay);
  const width = await problematicIntonationSlider.evaluate(
    (slider) => slider.clientWidth,
  );
  await problematicIntonationSlider.click({
    position: {
      x: width * (3 / 8),
      y: 0,
    },
  });
  await page.waitForTimeout(actionDelay);
  await moveCursorTo(playButton, 0.5, 0.5);
  await playButton.click();
  await waitForPlaying();
  audioTimes.push(Date.now());
  await waitForPlayingEnd();
  await page.waitForTimeout(cellDelay);
}

{
  appLogger.info("4: Adjust intonation");
  const cellInput = audioCells[3].locator("input").first();
  await moveCursorTo(cellInput, 0.2, 1);
  await cellInput.click();
  await page.waitForTimeout(actionDelay);
  await moveCursorTo(playButton, 0.5, 0.5);
  await playButton.click();
  await waitForPlaying();
  audioTimes.push(Date.now());
  await waitForPlayingEnd();
  await page.waitForTimeout(actionDelay);

  const intonationTab = page
    .locator(".detail-selector .q-tab", { hasText: "ｲﾝﾄﾈｰｼｮﾝ" })
    .first();
  await moveCursorTo(intonationTab, 0.5, 0.5);
  await intonationTab.click();

  const intonationSliders = await page
    .locator(".pitch-cell .q-slider__track")
    .all();
  const height = await intonationSliders[0].evaluate(
    (slider) => slider.clientHeight,
  );

  // メモ：イントネーションは3.0から6.5
  await moveCursorTo(intonationSliders[0], 0.5, unlerp(6.5, 3.0, 5.85));
  await page.waitForTimeout(keyboardDelay);
  await intonationSliders[0].click({
    position: {
      x: 0,
      y: unlerp(6.5, 3.0, 5.85) * height,
    },
  });
  await page.waitForTimeout(actionDelay);

  await moveCursorTo(intonationSliders[18], 0.5, unlerp(6.5, 3.0, 5.91));
  await page.waitForTimeout(keyboardDelay);
  await intonationSliders[18].click({
    position: {
      x: 0,
      y: unlerp(6.5, 3.0, 5.91) * height,
    },
  });
  await page.waitForTimeout(actionDelay);

  // メモ：長さは0.0から0.3

  const lengthTab = page.locator(".detail-selector .q-tab", {
    hasText: "長さ",
  });
  await moveCursorTo(lengthTab, 0.5, 0.5);
  await page.waitForTimeout(keyboardDelay);
  await lengthTab.click();
  await page.waitForTimeout(actionDelay);

  const lengthSliders = await page
    .locator(".pitch-cell .q-slider__track")
    .all();
  const lengthHeight = await lengthSliders[1].evaluate(
    (slider) => slider.clientHeight,
  );
  await moveCursorTo(lengthSliders[1], 0.5, unlerp(0.3, 0.0, 0.207));
  await page.waitForTimeout(keyboardDelay);
  await lengthSliders[1].click({
    position: {
      // これくらいの位置にないとMに判定を吸われる
      x: 5,
      y: unlerp(0.3, 0.0, 0.207) * lengthHeight,
    },
    force: true,
  });

  await page.waitForTimeout(actionDelay);

  await moveCursorTo(playButton, 0.5, 0.5);
  await playButton.click();
  await waitForPlaying();
  audioTimes.push(Date.now());
  await waitForPlayingEnd();

  await page.waitForTimeout(cellDelay);
}

{
  appLogger.info("5: Change character");
  const cellInput = audioCells[4].locator("input").first();
  await moveCursorTo(cellInput, 0.2, 1);
  await cellInput.click();
  await page.waitForTimeout(actionDelay);

  const characterButton = audioCells[4].locator(".character-button").first();
  await moveCursorTo(characterButton, 0.5, 0.5);
  await characterButton.click();
  await page.waitForTimeout(actionDelay);

  const zundamonButton = page.locator("button", {
    hasText: "ずんだもん",
  });
  await moveCursorTo(zundamonButton, 0.5, 0.5);
  await zundamonButton.click();
  await page.waitForTimeout(actionDelay);

  await moveCursorTo(playButton, 0.5, 0.5);
  await playButton.click();
  await waitForPlaying();
  audioTimes.push(Date.now());
  await waitForPlayingEnd();

  await page.waitForTimeout(cellDelay);
}

await page.waitForTimeout(1000);

await browser.close();

await fs.writeFile(
  path.join(compositePath, "timings.json"),
  JSON.stringify({
    startTime,
    loadedTime,
    audioTimes,
  }),
);
