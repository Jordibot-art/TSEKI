// lib/printEngine/mobileShare.ts

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { uint8ArrayToBase64 } from './index';

/**
 * Saves a rendered PDF Uint8Array to the app cache directory and launches
 * the native sharing / printing dialog on iOS and Android devices.
 */
export async function sharePdfBytes(
    bytes: Uint8Array,
    fileName: string,
    dialogTitle: string = 'Export PDF'
): Promise<string> {
    const base64 = uint8ArrayToBase64(bytes);
    const tempUri = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(tempUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
    });
    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(tempUri, {
            mimeType: 'application/pdf',
            dialogTitle,
            UTI: '.pdf',
        });
    }
    return tempUri;
}
