import { runOnDeviceSmokeTest } from '../smokeTest';

async function main() {
    console.log('--- Testing On-Device Smoke Test Logic ---');
    const result = await runOnDeviceSmokeTest();
    console.log(`Success: ${result.success}`);
    console.log(`Duration: ${result.durationMs}ms`);
    console.log(`Page count: ${result.pageCount}`);
    console.log(`PDF size: ${result.byteSize} bytes`);

    if (!result.success || result.pageCount !== 2) {
        console.error('Smoke test failed:', result.error);
        process.exit(1);
    }
    console.log('Smoke test passed successfully!');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
