/*
 * Created with @iobroker/create-adapter v2.1.1
 */

import * as utils from '@iobroker/adapter-core';
import * as faceapi from 'face-api.js';
import { Canvas, loadImage, Image } from 'canvas';
import { dirname } from 'path';
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
        this.log.info(`Ready to get image data from ${this.config.url}`);
        // TODO: test dev server
        this.config.url =
            'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/examples/images/bbt5.jpg';
        this.config.interval = 5;

        if (!this.config.url || !this.config.interval) {
            this.log.warn('Please configure adapter first');
            return;
        }

        await this.trainModel();
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
        const image = await loadImage(this.config.url);

        this.analyzeTimer = setTimeout(() => this.analyzeImage(), this.config.interval * 1000);
    }

    /**
     * Trains the model on the initial data, it is a lazy model currently, so only preprocess input
     */
    private async trainModel(): Promise<void> {
        await faceapi.nets.ssdMobilenetv1.loadFromDisk(`${__dirname}/../weights`);
        await this.transformTrainingData();
    }

    /**
     * Extracts faces from the training data and stores them
     */
    private async transformTrainingData(): Promise<void> {
        // TODO: for now we load from adapter dir
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

                await this.preprocessImageFromFile(
                    `${__dirname}/../images/train/${dir.name}/${image.name}`,
                    `${__dirname}/../images/train-preprocessed/${dir.name}/${image.name}`
                );
            }
        }
    }

    /**
     * Reads image from path and does preprocessing
     *
     * @param sourcePath path to read image from
     * @param targetPath path to write preprocessed image to
     */
    private async preprocessImageFromFile(sourcePath: string, targetPath: string): Promise<void> {
        // parse to any, because face api types seems to be made for FE
        const image: any = await loadImage(sourcePath);

        const faceDetection = await faceapi.detectSingleFace(
            image,
            new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
        );

        if (faceDetection) {
            const resizedFaceDetection = faceapi.resizeResults(faceDetection, { width: 150, height: 150 });
            const onlyFaceImage: any = (await faceapi.extractFaces(image, [resizedFaceDetection]))[0];

            // ensure dir exists
            const dirName = dirname(targetPath);
            if (!fs.existsSync(dirName)) {
                await fs.promises.mkdir(dirName, { recursive: true });
            }

            await fs.promises.writeFile(targetPath, onlyFaceImage.toBuffer('image/png'));
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new FaceRecognition(options);
} else {
    // otherwise start the instance directly
    (() => new FaceRecognition())();
}
