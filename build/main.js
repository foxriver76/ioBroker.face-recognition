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
    if (!this.config.url || !this.config.interval) {
      this.log.warn("Please configure adapter first");
      return;
    }
    await this.ensureMetaObject();
    this.log.info("Starting to train model");
    this.model = await this.trainModel();
    this.log.info("Model successfully trained");
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
    const detectedFaces = await faceapi.detectAllFaces(image).withFaceLandmarks().withFaceDescriptors();
    if (detectedFaces.length) {
      this.log.info(`Detected ${detectedFaces.length} faces`);
    }
    for (const { descriptor, detection } of detectedFaces) {
      const label = this.model.findBestMatch(descriptor).toString();
      this.log.info(`Detected ${label} with a confidence of ${detection.score}`);
      await this.setStateAsync("lastDetection", label, true);
    }
    this.analyzeTimer = setTimeout(() => this.analyzeImage(), this.config.interval * 1e3);
  }
  async trainModel() {
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(`${__dirname}/../weights`);
    await faceapi.nets.faceLandmark68Net.loadFromDisk("weights");
    await faceapi.nets.faceRecognitionNet.loadFromDisk("weights");
    const labeledFaceDescriptors = await this.transformTrainingData();
    return new faceapi.FaceMatcher(labeledFaceDescriptors);
  }
  async transformTrainingData() {
    const labeledFaceDescriptors = [];
    const dirs = await fs.promises.readdir(`${__dirname}/../images`, { withFileTypes: true });
    for (const dir of dirs) {
      const classFaceDescriptors = [];
      if (!dir.isDirectory()) {
        continue;
      }
      this.log.info(`Learning "${dir.name}"`);
      const imageNames = await fs.promises.readdir(`${__dirname}/../images/${dir.name}`, {
        withFileTypes: true
      });
      for (const image of imageNames) {
        if (image.isDirectory()) {
          continue;
        }
        const rawPath = `${__dirname}/../images/${dir.name}/${image.name}`;
        const preprocessedPath = `train-preprocessed/${dir.name}/${image.name}`;
        try {
          await this.resizeAndSaveFace(rawPath, preprocessedPath);
          const faceDescriptor = await this.computeFaceDescriptorFromFile(preprocessedPath);
          classFaceDescriptors.push(faceDescriptor);
        } catch (e) {
          this.log.warn(e.message);
        }
      }
      labeledFaceDescriptors.push(new faceapi.LabeledFaceDescriptors(dir.name, classFaceDescriptors));
    }
    return labeledFaceDescriptors;
  }
  async computeFaceDescriptorFromFile(sourcePath) {
    const iobFile = await this.readFileAsync(`${this.namespace}.images`, sourcePath);
    const image = await (0, import_canvas.loadImage)(iobFile.file);
    const faceDescriptor = await faceapi.computeFaceDescriptor(image);
    if (Array.isArray(faceDescriptor)) {
      this.log.warn(`Multiple targets at "${sourcePath}" this may reduce dedection performance`);
      return faceDescriptor[0];
    } else {
      return faceDescriptor;
    }
  }
  async resizeAndSaveFace(rawPath, preprocessedPath) {
    const image = await (0, import_canvas.loadImage)(rawPath);
    const detections = await faceapi.detectAllFaces(image);
    if (detections.length > 1) {
      throw new Error(`Cannot train image "${rawPath}", because more than one face detected`);
    } else if (detections.length === 0) {
      throw new Error(`Cannot train image "${rawPath}", because no face detected`);
    }
    const face = (await faceapi.extractFaces(image, detections))[0];
    await this.writeFileAsync(`${this.namespace}.images`, preprocessedPath, face.toBuffer("image/png"));
  }
  async ensureMetaObject() {
    await this.setObjectNotExistsAsync("images", {
      type: "meta",
      common: {
        name: "Images for training",
        type: "meta.folder"
      },
      native: {}
    });
  }
}
if (require.main !== module) {
  module.exports = (options) => new FaceRecognition(options);
} else {
  (() => new FaceRecognition())();
}
//# sourceMappingURL=main.js.map
