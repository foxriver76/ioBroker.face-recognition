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
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        if (!this.config.url || !this.config.interval) {
            this.log.warn('Please configure adapter first');
            return;
        }

        await this.ensureMetaObject();
        this.log.info('Starting to train model');
        this.model = await this.trainModel();
        this.log.info('Model successfully trained');

        this.analyzeImage();
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
        if (this.analyzeTimer) {
            this.analyzeTimer = null;
        }

        this.log.info(`Trying to get image from "${this.config.url}"`);

        // get our image where we will perform the recognition on
        const image: any = await loadImage(this.config.url);

        // detect all faces inside the image
        const detectedFaces = await faceapi.detectAllFaces(image).withFaceLandmarks().withFaceDescriptors();

        if (detectedFaces.length) {
            this.log.info(`Detected ${detectedFaces.length} faces`);
        }

        for (const { descriptor, detection } of detectedFaces) {
            const label = this.model!.findBestMatch(descriptor).toString();
            this.log.info(`Detected ${label} with a confidence of ${detection.score}`);
            await this.setStateAsync('lastDetection', label, true);
        }

        this.analyzeTimer = setTimeout(() => this.analyzeImage(), this.config.interval * 1000);
    }

    /**
     * Trains the model on the initial data, it is a lazy model currently, so only preprocess input
     */
    private async trainModel(): Promise<faceapi.FaceMatcher> {
        await faceapi.nets.ssdMobilenetv1.loadFromDisk(`${__dirname}/../weights`);
        await faceapi.nets.faceLandmark68Net.loadFromDisk('weights');
        await faceapi.nets.faceRecognitionNet.loadFromDisk('weights');
        const labeledFaceDescriptors = await this.transformTrainingData();
        return new faceapi.FaceMatcher(labeledFaceDescriptors);
    }

    /**
     * Extracts faces from the training data and stores them
     */
    private async transformTrainingData(): Promise<faceapi.LabeledFaceDescriptors[]> {
        // TODO: for now we load from adapter dir
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
                } catch (e: any) {
                    this.log.warn(e.message);
                }
            }

            labeledFaceDescriptors.push(new faceapi.LabeledFaceDescriptors(dir.name, classFaceDescriptors));
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
     * @param rawPath path to read image from
     * @param preprocessedPath path to write preprocessed image to in iobroker storage
     */
    private async resizeAndSaveFace(rawPath: string, preprocessedPath: string): Promise<void> {
        const image: any = await loadImage(rawPath);

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

    private async ensureMetaObject(): Promise<void> {
        await this.setObjectNotExistsAsync('images', {
            type: 'meta',
            common: {
                name: 'Images for training',
                type: 'meta.folder'
            },
            native: {}
        });
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new FaceRecognition(options);
} else {
    // otherwise start the instance directly
    (() => new FaceRecognition())();
}
