import fetch from 'node-fetch';
import FormData from 'form-data';

async function testTranscribeEndpoint() {
    console.log('--- TESTING TRANSCRIBE API ENDPOINT ---');

    // Create a 1-second silent WAV file buffer (header + silence sample)
    const sampleWavHeader = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // "RIFF"
        0x24, 0x08, 0x00, 0x00, // ChunkSize
        0x57, 0x41, 0x56, 0x45, // "WAVE"
        0x66, 0x6d, 0x74, 0x20, // "fmt "
        0x10, 0x00, 0x00, 0x00, // Subchunk1Size (16 for PCM)
        0x01, 0x00,             // AudioFormat (1 for PCM)
        0x01, 0x00,             // NumChannels (1 channel)
        0x44, 0xac, 0x00, 0x00, // SampleRate (44100)
        0x88, 0x58, 0x01, 0x00, // ByteRate
        0x02, 0x00,             // BlockAlign
        0x10, 0x00,             // BitsPerSample (16)
        0x64, 0x61, 0x74, 0x61, // "data"
        0x00, 0x08, 0x00, 0x00, // Subchunk2Size
    ]);

    const silenceBuffer = Buffer.alloc(2048);
    const wavBuffer = Buffer.concat([sampleWavHeader, silenceBuffer]);

    const formData = new FormData();
    formData.append('audio', wavBuffer, {
        filename: 'test_audio.wav',
        contentType: 'audio/wav',
    });

    const targetUrls = [
        'http://localhost:3000/api/transcribe',
        'http://localhost:3001/api/transcribe',
    ];

    let testPassed = false;

    for (const url of targetUrls) {
        try {
            console.log(`Testing endpoint: ${url}`);
            const response = await fetch(url, {
                method: 'POST',
                body: formData as any,
                headers: formData.getHeaders(),
            });

            console.log(`HTTP Status: ${response.status}`);
            const textResult = await response.text();
            console.log(`Response Body: ${textResult}`);

            if (response.ok || response.status === 422) {
                // 422 means audio buffer was processed cleanly by transcribe service (returned "Could not transcribe silent audio")
                // 200 means audio transcription succeeded
                console.log(`✓ Transcribe API at ${url} is operational and responsive!`);
                testPassed = true;
                break;
            }
        } catch (err: any) {
            console.warn(`Connection to ${url} failed:`, err?.message);
        }
    }

    if (testPassed) {
        console.log('🎉 TRANSCRIBE API TEST PASSED SUCCESSFUL! 🎉');
    } else {
        console.error('❌ Transcribe API test failed across all target ports.');
    }
}

testTranscribeEndpoint();
