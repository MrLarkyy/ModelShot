// filterTexelColor of the mesh passes' nearest variant (shaderSources.ts): the nearest taps' colour stays. No linear
// code is linked into it, as SwiftShader paid for the untaken linear branch in every fragment (MS-90).
void filterTexelColor(inout TexelSample s, sampler2D tex, vec2 p, vec2 dx, vec2 dy, vec2 texelsPerPixel, TexelAddress a,
    int mode, int cutoffByte) {}
