#!/usr/bin/env node
import fetch from 'node-fetch';
import QRCode from 'qrcode';
import os from 'os';
import clipboardy from 'clipboardy';
import chalk from 'chalk';
import http from 'http';
import fs from 'fs';
import { program } from 'commander';
import { exec } from 'child_process';

program
    .version('1.0.0')
    .option('-f, --format [format]', 'format file path')
    .option('-l, --long [long]', 'use raw data')
    .parse(process.argv);

const options = program.opts();

const logger = {
    ...console,
    success: (...args) => console.log(chalk.green(...args)),
    error: (...args) => {
        console.log(chalk.red(...args));
        process.exit();
    },
};

const readFormClipboard = async () => {
    try {
        const text = await clipboardy.read();
        return text;
    } catch {
        return '';
    }
};

const checkFile = async (path) => {
    return new Promise((resolve, reject) => {
        fs.stat(path, (err, stats) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

const formatText = async (text, formatFilePath) => {
    try {
        await checkFile(formatFilePath);
        const formattedText = await new Promise((resolve) => {
            const child = exec(`node ${formatFilePath} '${text}'`, {
                stdio: 'pipe',
            });
            child.stdout.on('data', resolve);
        });
        return formattedText;
    } catch (err) {
        logger.error(err);
    }
};

const showQR = async (text) => {
    return new Promise((resolve, reject) => {
        QRCode.toString(
            text,
            { type: 'terminal', small: true },
            function (err, code) {
                if (err) {
                    reject(err);
                    return;
                }
                logger.clear();
                logger.success(text);
                logger.log(code);
                resolve();
            }
        );
    })
};

const getAvailablePort = async (start = 8000, end = 9000) => {
    return new Promise((resolve, reject) => {
        const server = http.createServer();
        server.unref();

        let port = start;
        server.on('error', () => {
            if (port <= end) {
                port++;
                server.listen(port);
            } else {
                reject(new Error('No available ports'));
            }
        });

        server.on('listening', () => {
            server.close(() => {
                resolve(port);
            });
        });
        server.listen(port);
    });
};

const getHostName = () => {
    const interfaces = os.networkInterfaces();
    for (let key in interfaces) {
        for (let i = 0; i < interfaces[key].length; i++) {
            const iface = interfaces[key][i];
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
};

const checkIsLinkOrSchema = (text) => {
    return /^[a-zA-Z]+:\/\//.test(`${text}`);
};

const createShortServer = (hostname, port) => {
    return new Promise((resolve) => {
        let short = '';
        let long = '';
        const server = http.createServer(serveHttp);
        server.listen(port, () => {
            resolve();
        });
        function serveHttp(req, res) {
            const { method, url: path } = req;
            if (path === '/api/getShortUrl' && method === 'POST') {
                let body = '';
                req.on('data', (chunk) => {
                    body += chunk.toString();
                });
                req.on('end', async () => {
                    const json = JSON.parse(body);
                    long = json.value;
                    const random = Math.random().toString(16).slice(2);
                    short = `http://${hostname}:${port}/short/${random}`;
                    res.end(short);
                });
            } else {
                if (checkIsLinkOrSchema(long)) {
                    res.writeHead(302, { Location: long });
                    res.end();
                }
                else {
                    res.end(long);
                }
                const clear = () => {
                    setTimeout(() => {
                        if (res.finished) {
                            logger.clear();
                            server.close();
                            process.exit(0);
                        }
                        else {
                            clear();
                        }
                    }, 200);
                };
                clear();
            }
        }
    });
};

const getShort = async (hostname, port, value) => {
    try {
        const res = await fetch(`http://${hostname}:${port}/api/getShortUrl`, {
            method: 'POST',
            body: JSON.stringify({ value }),
        });
        const text = await res.text();
        return text;
    } catch {
        return value;
    }
};

const main = async () => {
    try {
        let text = await readFormClipboard();
        if (!text) {
            logger.error('Empty text from clipboard!');
            return;
        }
        if (options.format && options.format !== true) {
            text = await formatText(text, options.format);
        }
        if (options.long) {
            showQR(text);
            return;
        }
        const port = await getAvailablePort();
        const hostname = getHostName();
        await createShortServer(hostname, port);
        const short = await getShort(hostname, port, text);
        showQR(short);
    } catch (err) {
        logger.error(err);
    }
};

main();
