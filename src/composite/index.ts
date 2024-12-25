import fs from "node:fs/promises";
import path from "node:path";
import timings from "./timings.json";
import { execSync } from "node:child_process";
import { appLogger } from "../log";

const videosDir = path.join(import.meta.dirname, "videos");
const videosDirFiles = await fs.readdir(videosDir);
const videoPath = path.join(videosDir, videosDirFiles[0]);
appLogger.info`Video path: ${videoPath}`;

const setupDuration = timings.loadedTime - timings.startTime;

const dist = path.join(import.meta.dirname, "dist.mp4");
appLogger.info`Dist: ${dist}`;
execSync(`ffmpeg -i ${videoPath} -ss ${setupDuration / 1000} ${dist} -y`, {
  stdio: "inherit",
});
