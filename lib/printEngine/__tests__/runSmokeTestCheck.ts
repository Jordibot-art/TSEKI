import './nodeIO';
import { runOnDeviceSmokeTest } from '../smokeTest';

async function main() {
    console.log('--- Testing On-Device Smoke Test Logic ---');
    const result = await runOnDeviceSmokeTest();
    console.log(`Success: ${result.success}`);
    console.log(`Total Duration: ${result.durationMs}ms`);
    console.log(`  • Font Load & Embed: ${result.fontLoadMs}ms`);
    console.log(`  • Layout Pass (LAYOUT_ONLY): ${result.layoutPassMs}ms`);
    console.log(`  • 2-Page PDF Build: ${result.pdfBuildMs}ms`);
    console.log(`  • File Write: ${result.fileWriteMs}ms`);
    console.log(`Page count: ${result.pageCount}`);
    console.log(`PDF size: ${result.byteSize} bytes`);

    if (
        !result.success ||
        result.pageCount !== 2 ||
        result.fontLoadMs <= 0 ||
        result.layoutPassMs <= 0 ||
        result.pdfBuildMs <= 0 ||
        result.fileWriteMs <= 0
    ) {
        console.error('Smoke test failed:', result.error);
        process.exit(1);
    }
    console.log('Smoke test passed successfully!');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
