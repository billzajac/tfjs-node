/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

const fs = require("fs");
const http = require("http");
const https = require("https");
const HttpsProxyAgent = require("https-proxy-agent");
const path =
  require("os").platform() === "win32"
    ? require("path")
    : require("path").win32;
const ProgressBar = require("progress");
const tar = require("tar");
const url = require("url");
const util = require("util");
const unzipper = require("unzipper"); // Use unzipper instead of adm-zip!

const unlink = util.promisify(fs.unlink);

/**
 * Downloads and unpacks a given tarball or zip file at a given path.
 * @param {string} uri The path of the compressed file to download and extract.
 * @param {string} destPath The destination path for the compressed content.
 * @param {Function} callback Handler for when downloading and extraction is complete.
 */
async function downloadAndUnpackResource(uri, destPath, callback) {
  const httpClient = uri.startsWith("https") ? https : http;

  const proxy =
    process.env["HTTPS_PROXY"] ||
    process.env["https_proxy"] ||
    process.env["HTTP_PROXY"] ||
    process.env["http_proxy"] ||
    "";

  const options = { ...url.parse(uri), agent: httpClient.globalAgent };

  if (proxy !== "") {
    options.agent = new HttpsProxyAgent(proxy);
  }

  const request = httpClient.get(options, (response) => {
    const totalSize = parseInt(response.headers["content-length"], 10);
    const bar = new ProgressBar("[:bar] :rate/bps :percent :etas", {
      complete: "=",
      incomplete: " ",
      width: 30,
      total: totalSize,
    });

    if (uri.endsWith(".zip")) {
      const tempFileName = path.join(__dirname, "_tmp.zip");
      const outputFile = fs.createWriteStream(tempFileName);

      response.on("data", (chunk) => bar.tick(chunk.length));
      response.pipe(outputFile);

      outputFile.on("close", async () => {
        // After download is complete, extract
        fs.createReadStream(tempFileName)
          .pipe(unzipper.Extract({ path: destPath }))
          .on("close", async () => {
            await unlink(tempFileName); // Delete the temp file after extraction
            if (callback !== undefined) {
              callback();
            }
          })
          .on("error", async (err) => {
            console.error("Extraction error:", err);
            await unlink(tempFileName);
            if (callback !== undefined) {
              callback(err);
            }
          });
      });
    } else if (uri.endsWith(".tar.gz")) {
      response.on("data", (chunk) => bar.tick(chunk.length));
      response
        .pipe(tar.x({ C: destPath, strict: true }))
        .on("close", () => {
          if (callback !== undefined) {
            callback();
          }
        })
        .on("error", (err) => {
          console.error("Extraction error:", err);
          if (callback !== undefined) {
            callback(err);
          }
        });
    } else {
      throw new Error(`Unsupported packed resource: ${uri}`);
    }
  });

  request.on("error", (err) => {
    console.error("Request error:", err);
    if (callback !== undefined) {
      callback(err);
    }
  });

  request.end();
}

module.exports = { downloadAndUnpackResource };
