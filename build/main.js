var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target, mod));
var utils = __toESM(require("@iobroker/adapter-core"));
var faceapi = __toESM(require("face-api.js"));
var import_canvas = require("canvas");
var import_path = require("path");
var import_node_fetch = __toESM(require("node-fetch"));
var fs = __toESM(require("fs"));
faceapi.env.monkeyPatch({ Canvas: import_canvas.Canvas, Image: import_canvas.Image, fetch: import_node_fetch.default });
class FaceRecognition extends utils.Adapter {
  constructor(options = {}) {
    super(__spreadProps(__spreadValues({}, options), {
      name: "face-recognition"
    }));
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    this.log.info(`Ready to get image data from ${this.config.url}`);
    this.config.url = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/examples/images/bbt5.jpg";
    this.config.interval = 5;
    if (!this.config.url || !this.config.interval) {
      this.log.warn("Please configure adapter first");
      return;
    }
    await this.trainModel();
    this.analyzeImage();
  }
  onUnload(callback) {
    try {
      if (this.analyzeTimer) {
        clearTimeout(this.analyzeTimer);
        this.analyzeTimer = null;
      }
      callback();
    } catch {
      callback();
    }
  }
  async analyzeImage() {
    if (this.analyzeTimer) {
      this.analyzeTimer = null;
    }
    this.log.info(`Trying to get image from "${this.config.url}"`);
    const image = await (0, import_canvas.loadImage)(this.config.url);
    this.analyzeTimer = setTimeout(() => this.analyzeImage(), this.config.interval * 1e3);
  }
  async trainModel() {
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(`${__dirname}/../weights`);
    await this.transformTrainingData();
  }
  async transformTrainingData() {
    const dirs = await fs.promises.readdir(`${__dirname}/../images/train`, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) {
        continue;
      }
      this.log.info(`Learning "${dir.name}"`);
      const imageNames = await fs.promises.readdir(`${__dirname}/../images/train/${dir.name}`, {
        withFileTypes: true
      });
      for (const image of imageNames) {
        if (image.isDirectory()) {
          continue;
        }
        await this.preprocessImageFromFile(`${__dirname}/../images/train/${dir.name}/${image.name}`, `${__dirname}/../images/train-preprocessed/${dir.name}/${image.name}`);
      }
    }
  }
  async preprocessImageFromFile(sourcePath, targetPath) {
    const image = await (0, import_canvas.loadImage)(sourcePath);
    const faceDetection = await faceapi.detectSingleFace(image, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }));
    if (faceDetection) {
      const resizedFaceDetection = faceapi.resizeResults(faceDetection, { width: 150, height: 150 });
      const onlyFaceImage = (await faceapi.extractFaces(image, [resizedFaceDetection]))[0];
      const dirName = (0, import_path.dirname)(targetPath);
      if (!fs.existsSync(dirName)) {
        await fs.promises.mkdir(dirName, { recursive: true });
      }
      await fs.promises.writeFile(targetPath, onlyFaceImage.toBuffer("image/png"));
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new FaceRecognition(options);
} else {
  (() => new FaceRecognition())();
}
//# sourceMappingURL=main.js.map
