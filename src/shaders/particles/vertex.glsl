uniform vec2 uResolution;
uniform float uSize;

// Texture FBO calculée par le GPGPU : contient la position (RGB) et l'alpha (vie) de chaque particule
uniform sampler2D uParticlesTexture;

attribute vec2 aParticlesUV;
attribute vec3 aColor;
attribute float aSize;

varying vec3 vColor;

void main()
{
    // La fonction texture retourne le RGBA du point
    vec4 particle = texture(uParticlesTexture, aParticlesUV);

    // Final position
    vec4 modelPosition = modelMatrix * vec4(particle.xyz, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;
    gl_Position = projectedPosition;

    // Point size
    // Fondu de taille en fonction du cycle de vie de la particule
    // sizeIn : la particule grossit au début de sa vie
    float sizeIn = smoothstep(0.0, 0.1, particle.a);
    // sizeOut : la particule rétrécit en fin de vie (disparition progressive avant reset)
    float sizeOut = 1.0 - smoothstep(0.7, 1.0, particle.a);
    // On combine les deux pour avoir un fondu entrée + sortie
    float size = min(sizeIn, sizeOut);

    // Point size
    gl_PointSize = size * uSize * uResolution.y * aSize;
    gl_PointSize *= (1.0 / - viewPosition.z);

    // Varyings
    vColor = aColor;
}