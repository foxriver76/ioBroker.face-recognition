/*
 * Created with @iobroker/create-adapter v2.1.1
 */

import * as utils from '@iobroker/adapter-core';
import * as faceapi from 'face-api.js';
import { Canvas, loadImage, Image } from 'canvas';
import fetch from 'node-fetch';
import * as fs from 'fs';

faceapi.env // @ts-expect-error as docs
    .monkeyPatch({ Canvas, Image, fetch });

class FaceRecognition extends utils.Adapter {
    private analyzeTimer?: NodeJS.Timer | null;
    private model?: faceapi.FaceMatcher;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'face-recognition'
        });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('stateChange', this.analyzeImage.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        if (!this.config.url) {
            this.log.warn('Please configure url in adapter configuration first');
            return;
        }

        if (this.config.reloadTrainingData) {
            await this.uploadTrainingData();
            this.log.info('Training data successfully uploaded. Restarting adapter now');
            await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
                native: { reloadTrainingData: false }
            });
            return;
        }

        await this.ensureMetaObject();
        await this.loadWeights();

        if (this.config.retrain) {
            this.log.info('Starting to train model');
            try {
                this.model = await this.trainModel();
            } catch (e: any) {
                this.log.error(`Could not train model: ${e.message}`);
                this.restart();
                return;
            }

            this.log.info('Model successfully trained. Restarting adapter now');
            await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
                native: { retrain: false }
            });
            return;
        } else {
            this.log.info('Trying to load saved model');
            try {
                this.model = await this.loadModel();
                this.log.info('Successfully loaded model');
            } catch (e: any) {
                this.log.error(`Could not load model: ${e.message}`);
                this.restart();
                return;
            }
        }

        this.subscribeStates('performDetection');
        if (this.config.interval) {
            this.analyzeImage();
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    private onUnload(callback: () => void): void {
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

    /**
     * Whole process of retriving image and analyzing it
     */
    private async analyzeImage(): Promise<void> {
        if (!this.model) {
            this.log.warn('Model not ready yet');
            return;
        }

        if (this.analyzeTimer) {
            clearTimeout(this.analyzeTimer);
            this.analyzeTimer = null;
        }

        this.log.info(`Trying to get image from "${this.config.url}"`);

        // get our image where we will perform the recognition on
        const image: any = await loadImage(this.config.url);

        // detect all faces inside the image
        const detectedFaces = await faceapi.detectAllFaces(image).withFaceLandmarks().withFaceDescriptors();

        if (detectedFaces.length) {
            this.log.info(`Detected ${detectedFaces.length} face/s`);
        }

        for (const { descriptor, detection } of detectedFaces) {
            const label = this.model.findBestMatch(descriptor).toString();
            this.log.info(`Detected ${label} with a confidence of ${detection.score}`);
            await this.setStateAsync('lastDetection', label, true);
        }

        if (this.config.interval) {
            this.analyzeTimer = setTimeout(() => this.analyzeImage(), this.config.interval * 1000);
        }
    }

    /**
     * Trains the model on the initial data, it is a lazy model currently, so only preprocess input
     */
    private async trainModel(): Promise<faceapi.FaceMatcher> {
        const labeledFaceDescriptors = await this.transformTrainingData();
        return new faceapi.FaceMatcher(labeledFaceDescriptors);
    }

    /**
     * Extracts faces from the training data and stores them
     */
    private async transformTrainingData(): Promise<faceapi.LabeledFaceDescriptors[]> {
        const labeledFaceDescriptors: faceapi.LabeledFaceDescriptors[] = [];
        const dirs = await this.readDirAsync(`${this.namespace}.images`, 'train');
        for (const dir of dirs) {
            const classFaceDescriptors = [];
            if (!dir.isDir) {
                continue;
            }

            this.log.info(`Learning "${dir.file}"`);

            const imageNames = await this.readDirAsync(`${this.namespace}.images`, `train/${dir.file}`);

            for (const image of imageNames) {
                if (image.isDir) {
                    continue;
                }

                const rawPath = `train/${dir.file}/${image.file}`;
                const preprocessedPath = `train-preprocessed/${dir.file}/${image.file}`;
                try {
                    await this.resizeAndSaveFace(rawPath, preprocessedPath);
                    const faceDescriptor = await this.computeFaceDescriptorFromFile(preprocessedPath);

                    classFaceDescriptors.push(faceDescriptor);
                } catch (e: any) {
                    this.log.warn(e.message);
                }
            }

            const classDescriptor = new faceapi.LabeledFaceDescriptors(dir.file, classFaceDescriptors);
            await this.saveModel(classDescriptor);
            labeledFaceDescriptors.push(classDescriptor);
        }

        return labeledFaceDescriptors;
    }

    /**
     * Reads image from path and does preprocessing
     *
     * @param sourcePath path to read image from in ioBroker storage
     */
    private async computeFaceDescriptorFromFile(sourcePath: string): Promise<Float32Array> {
        const iobFile = await this.readFileAsync(`${this.namespace}.images`, sourcePath);
        // parse to any, because face api types seems to be made for FE
        // @ts-expect-error types are wrong
        const image: any = await loadImage(iobFile.file);
        const faceDescriptor = await faceapi.computeFaceDescriptor(image);

        if (Array.isArray(faceDescriptor)) {
            this.log.warn(`Multiple targets at "${sourcePath}" this may reduce dedection performance`);
            return faceDescriptor[0];
        } else {
            return faceDescriptor;
        }
    }

    /**
     * Extracts the face and saves it in the preprocessed folder
     *
     * @param rawPath path to read image from in ioBroker storage
     * @param preprocessedPath path to write preprocessed image to in iobroker storage
     */
    private async resizeAndSaveFace(rawPath: string, preprocessedPath: string): Promise<void> {
        const file = await this.readFileAsync(`${this.namespace}.images`, rawPath);
        // @ts-expect-error wrong types
        const image: any = await loadImage(file.file);

        const detections = await faceapi.detectAllFaces(image);

        if (detections.length > 1) {
            throw new Error(`Cannot train image "${rawPath}", because more than one face detected`);
        } else if (detections.length === 0) {
            throw new Error(`Cannot train image "${rawPath}", because no face detected`);
        }

        const face: any = (await faceapi.extractFaces(image, detections))[0];

        // write the preprocessed version to iobroker storage
        await this.writeFileAsync(`${this.namespace}.images`, preprocessedPath, face.toBuffer('image/png'));
    }

    /**
     * Creates the necessary meta objects for file persistence
     */
    private async ensureMetaObject(): Promise<void> {
        await this.setObjectNotExistsAsync('images', {
            type: 'meta',
            common: {
                name: 'Images for training',
                type: 'meta.folder'
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('models', {
            type: 'meta',
            common: {
                name: 'Trained models',
                type: 'meta.folder'
            },
            native: {}
        });
    }

    /**
     * Loads the training data brought with adapter to the iobroker storage
     */
    private async uploadTrainingData(): Promise<void> {
        const dirs = await fs.promises.readdir(`${__dirname}/../images`, { withFileTypes: true });
        for (const dir of dirs) {
            if (!dir.isDirectory()) {
                continue;
            }

            this.log.info(`Uploading images for "${dir.name}"`);

            const imageNames = await fs.promises.readdir(`${__dirname}/../images/${dir.name}`, {
                withFileTypes: true
            });

            for (const image of imageNames) {
                if (image.isDirectory()) {
                    continue;
                }

                const sourcePath = `${__dirname}/../images/${dir.name}/${image.name}`;
                const targetPath = `train/${dir.name}/${image.name}`;

                try {
                    const image = await fs.promises.readFile(sourcePath);
                    await this.writeFileAsync(`${this.namespace}.images`, targetPath, image);
                } catch (e: any) {
                    this.log.warn(`Could not upload file "${image.name}": ${e.message}`);
                }
            }
        }
    }

    /**
     * Saves given labeled descriptors
     * @param labeledDescriptors - labeled face descriptors for a label
     */
    private async saveModel(labeledDescriptors: faceapi.LabeledFaceDescriptors) {
        await this.writeFileAsync(
            `${this.namespace}.models`,
            labeledDescriptors.label,
            JSON.stringify(labeledDescriptors.toJSON())
        );
    }

    /**
     * Tries to load saved model from ioBroker storage
     */
    private async loadModel(): Promise<faceapi.FaceMatcher> {
        const labeledFaceDescriptors: faceapi.LabeledFaceDescriptors[] = [];

        const dir = await this.readDirAsync(`${this.namespace}.models`, '');
        for (const entry of dir) {
            if (entry.isDir) {
                continue;
            }

            const descriptorFile = await this.readFileAsync(`${this.namespace}.models`, entry.file);
            // @ts-expect-error types are wrong
            const descriptor = faceapi.LabeledFaceDescriptors.fromJSON(JSON.parse(descriptorFile.file));
            this.log.info(`Loaded model for "${descriptor.label}"`);
            labeledFaceDescriptors.push(descriptor);
        }

        return new faceapi.FaceMatcher(labeledFaceDescriptors);
    }

    /**
     * Loads weights for the models
     */
    private async loadWeights(): Promise<void> {
        await faceapi.nets.ssdMobilenetv1.loadFromDisk(`${__dirname}/../weights`);
        await faceapi.nets.faceLandmark68Net.loadFromDisk('weights');
        await faceapi.nets.faceRecognitionNet.loadFromDisk('weights');
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new FaceRecognition(options);
} else {
    // otherwise start the instance directly
    (() => new FaceRecognition())();
}
