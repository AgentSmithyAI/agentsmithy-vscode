/* eslint-disable no-undef */
import * as fs from 'fs';
import * as crypto from 'crypto';

/**
 * Calculate SHA256 hash of a file
 */
export const calculateFileSHA256 = (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data: string | Buffer) => {
      hash.update(data);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    stream.on('error', (error: Error) => {
      reject(error);
    });
  });
};
