/*
 * Created with @iobroker/create-adapter v2.1.1
 */

import * as utils from '@iobroker/adapter-core';
//import * as faceapi from 'face-api.js';

class FaceRecognition extends utils.Adapter {
    private analyzeTimer?: NodeJS.Timer | null;
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
        this.config.url = '';
        this.config.interval = 5;

        if (!this.config.url || !this.config.interval) {
            this.log.warn('Please configure adapter first');
            return;
        }

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

        const image = await this.loadImage();
        this.log.info(JSON.stringify(image));

        this.analyzeTimer = setTimeout(() => this.analyzeImage(), this.config.interval * 1000);
    }

    /**
     * Loads the image from the configured url
     */
    private async loadImage(): Promise<any> {
        const response = await fetch(this.config.url);
        this.log.info(JSON.stringify(response));
        return response;
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new FaceRecognition(options);
} else {
    // otherwise start the instance directly
    (() => new FaceRecognition())();
}
