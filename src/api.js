import axios from "axios";
import { NetworkTracker } from "./network.js";

export class API {
    constructor(
        page,
        config = {
            baseURL: null,
            headers: {},
            cookies: [],
        },
        apiResponseCallback = null
    ) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        this.page = page;
        this.config = config;
        this._requests = [];
        if (this.page) {
            this.network = new NetworkTracker(this.page, apiResponseCallback);
        }
    }

    async _request(method, url, params = {}, headers = {}, data = {}) {
        let timeStart = Date.now();
        const fullUrl = `${this.config.baseURL || ""}${url}`;
        const response = await axios.request({
            responseType: "json",
            method,
            url: fullUrl,
            params,
            headers: { ...(this.config?.headers || {}), ...headers },
            data,
            withCredentials: true,
        });
        let timeEnd = Date.now();
        return { status: response.status, data: response.data, time: timeEnd - timeStart };
    }

    async get(url, params = {}, headers = {}) {
        return await this._request("get", url, params, headers);
    }

    async post(url, data = {}, headers = {}) {
        return await this._request("post", url, {}, headers, data);
    }

    async put(url, data = {}, headers = {}) {
        return await this._request("put", url, {}, headers, data);
    }

    async patch(url, data = {}, headers = {}) {
        return await this._request("patch", url, {}, headers, data);
    }

    async delete(url, data = {}, headers = {}) {
        return await this._request("delete", url, {}, headers, data);
    }

    async waitForIdle(timeout = 10000) {
        if (this.network) {
            await this.network.waitForIdle({ timeout });
        }
    }
}
