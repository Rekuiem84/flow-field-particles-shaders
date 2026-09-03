uniform float uTime;
uniform float uDeltaTime;

uniform sampler2D uBase;

uniform float uFlowFieldInfluence;  // Seuil sur le bruit qui détermine la proportion de particules réellement affectées
uniform float uFlowFieldStrength;   // Intensité du déplacement dans le flow field
uniform float uFlowFieldFrequency;  // Fréquence spatiale du bruit (échelle du flow field)

#include ../includes/simplexNoise4d.glsl

void main(){
  float time = uTime * 0.2;

  // Coordonnée UV du pixel courant = position de la particule qu'on traite dans le FBO
  vec2 uv = gl_FragCoord.xy / resolution.xy;

  // Lecture de l'état courant (frame précédente) et de l'état initial de la particule
  vec4 particle = texture(uParticles, uv);
  vec4 base = texture(uBase, uv);

  // Particule morte (alpha >= 1)
  if(particle.a >= 1.0){
    // On fait recommencer le cycle de vie de la particule
    particle.a = mod(particle.a, 1.0);
    // On la replace à sa position d'origine
    particle.xyz = base.xyz;
  }

  // Particule vivante
  else{
    // Force / intensité du mouvement en fonction d'un bruit dépendant de la position d'origine
    float strength = simplexNoise4d(vec4(base.xyz * 0.2, time + 1.0));
    float influence = (uFlowFieldInfluence - 0.5) * (-2.0);
    strength = smoothstep(influence, 1.0, strength);

    // Flow field
    // Direction vers laquelle chaque particule va flotter
    // 3 appels de bruit décalés (+0, +1, +2) pour obtenir des composantes X/Y/Z décorrélées,
    // basés sur la position ACTUELLE de la particule (contrairement à "strength" basé sur la position d'origine)
    vec3 flowField = vec3(
      simplexNoise4d(vec4(particle.xyz * uFlowFieldFrequency + 0.0, time)),
      simplexNoise4d(vec4(particle.xyz * uFlowFieldFrequency + 1.0, time)),
      simplexNoise4d(vec4(particle.xyz * uFlowFieldFrequency + 2.0, time))
    );
    flowField = normalize(flowField);
    // On finit par modifier la position en fonction de la direction, du temps, de l'influence et de la force
    particle.xyz += flowField * uDeltaTime * strength * uFlowFieldStrength;

    // Vieillissement de la particule
    particle.a += uDeltaTime * 0.3;
  }

  gl_FragColor = particle;
}