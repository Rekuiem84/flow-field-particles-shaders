import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import GUI from "lil-gui";
import particlesVertexShader from "./shaders/particles/vertex.glsl";
import particlesFragmentShader from "./shaders/particles/fragment.glsl";
import gpgpuParticlesShader from "./shaders/gpgpu/particles.glsl";
import { GPUComputationRenderer } from "three/examples/jsm/Addons.js";

/**
 * Base
 */
// Debug
const gui = new GUI({ width: 340 });
const debugObject = {};

// Canvas
const canvas = document.querySelector("canvas.webgl");

// Scene
const scene = new THREE.Scene();

// Loaders
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("./draco/");

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

/**
 * Sizes
 */
const sizes = {
	width: window.innerWidth,
	height: window.innerHeight,
	pixelRatio: Math.min(window.devicePixelRatio, 2),
};

window.addEventListener("resize", () => {
	// Update sizes
	sizes.width = window.innerWidth;
	sizes.height = window.innerHeight;
	sizes.pixelRatio = Math.min(window.devicePixelRatio, 2);

	// Materials
	particles.material.uniforms.uResolution.value.set(
		sizes.width * sizes.pixelRatio,
		sizes.height * sizes.pixelRatio,
	);

	// Update camera
	camera.aspect = sizes.width / sizes.height;
	camera.updateProjectionMatrix();

	// Update renderer
	renderer.setSize(sizes.width, sizes.height);
	renderer.setPixelRatio(sizes.pixelRatio);
});

/**
 * Camera
 */
// Base camera
const camera = new THREE.PerspectiveCamera(
	35,
	sizes.width / sizes.height,
	0.1,
	100,
);
camera.position.set(10, 4, 12);
scene.add(camera);

// Controls
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
	canvas: canvas,
	antialias: true,
});
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(sizes.pixelRatio);

debugObject.clearColor = "#231515";
renderer.setClearColor(debugObject.clearColor);

/**
 * Load model
 */
/**
 * Au lieu d'utiliser une callback function qui serait très longue danx gltfLoader.load(),
 * on peut utiliser une Promise avec await et gltfLoader.loadAsync() pour ce projet démo
 * mais dans un vrai projet, il faut utiliser la callback function, pour éviter l'écran blanc de chargement
 * 
 * Cepandant, pour utiliser await, il faut modifier `vite.config.js` avec :
 * build:
    {
        // ...
        target: 'esnext'
    },
    ce qui va permettre à vite de bien build l'app, et compatible avec les browsers modernes
 */
const gltf = await gltfLoader.loadAsync("./model.glb");

/**
 * Base Geometry
 */
// La geometrie doit être utilisée dans le FBO, et dans la scène, donc on créé un objet qu'on va réutiliser
const baseGeometry = {};
baseGeometry.instance = gltf.scene.children[0].geometry;
baseGeometry.count = baseGeometry.instance.attributes.position.count; // nombre de vertex -> de particules

/**
 * GPU Compute
 */
/**
 * Le GPGPU (General-Purpose computing on Graphics Processing Units) permet d'utiliser le GPU  pour traiter des données
 * plutôt que d'afficher des pixels à l'utilisateur. Utilisé pour faire des milliers de fois une opération complexe
 *
 * Pour ce projet il permet de calculer le flow field, que le CPU ne pourrait pas gérer efficacement à 60fps (des milliers d'opérations par seconde)
 * Le flow field est une "texture" pour laquelle à chaque point, on calcule une direction
 *
 * Nous avons besoin de d'avoir une persistance des données, puisque la direction d'une particule dans le flow field est imprévisible,
 * donc pour calculer la position à la frame n+1, nous avons besoin de connaitre sa position à la frame n.
 *
 * Il serait possible d'enregistrer la position dans un attribute pour chaque particule, mais les performances seraient catastrophiques
 *
 * Le GPGPU résout parfaitement ce problème en utilisant le GPU et grâce à un FBO (Frame Buffer Object)
 *
 * Le FBO est une texture danx laquelle on va enregistrer la position des particules grace aux channels RGB, pour la position XYZ
 * Le FBO n'est pas une texture visible sur le canvas, et il sera créé avec WebGLRenderTarget
 *
 * Le FBO existe en 2 itérations, un qui est lu à la frame n, l'autre qui est modifié, puis à la frame n+1 leur role s'inverse (on ne peut pas read et write en même temps)
 * Grâce à ce décalage de 1 frame, la FBO qui était en write à la frame n, devient read à n+1, et a l'état précédent des particules => persistance d'une frame à l'autre
 *
 * Au final, chaque particule aura un pixel de la texture du FBO qui lui sera assigné, et sa position dépendra de ses valeurs RGB
 */
const gpgpu = {};
// La texture créée sera un carré pour faciliter les calcules de coordonnées des pixels
gpgpu.size = Math.ceil(Math.sqrt(baseGeometry.count));

// gpgpu.computation est une texture qui contient les coordonnées des particles
gpgpu.computation = new GPUComputationRenderer(
	gpgpu.size,
	gpgpu.size,
	renderer, // On réutilise le même renderer
);

// Base particles (état initial des particules)
const baseParticlesTexture = gpgpu.computation.createTexture();

for (let i = 0; i < baseGeometry.count; i++) {
	const i3 = i * 3; // XYZ coords
	const i4 = i * 4; // Alpha channel

	// Position en fonction de la géométrie
	baseParticlesTexture.image.data[i4 + 0] =
		baseGeometry.instance.attributes.position.array[i3 + 0]; // Position X
	baseParticlesTexture.image.data[i4 + 1] =
		baseGeometry.instance.attributes.position.array[i3 + 1]; // Position Y
	baseParticlesTexture.image.data[i4 + 2] =
		baseGeometry.instance.attributes.position.array[i3 + 2]; // Position Z
	baseParticlesTexture.image.data[i4 + 3] = Math.random(); // Alpha
}

// Particles variable
gpgpu.particlesVariable = gpgpu.computation.addVariable(
	"uParticles", // Nom qui sera fourni au fragment shader
	gpgpuParticlesShader,
	baseParticlesTexture, // Texture initiale
);
// Indique que uParticles dépend de lui-même,
// le shader recevra, à chaque calcul, sa propre texture de la frame précédente comme donnée d'entrée
// (sous le nom déclaré dans addVariable, ici uParticles). C'est ce qui permet la persistance entre les frames
gpgpu.computation.setVariableDependencies(gpgpu.particlesVariable, [
	gpgpu.particlesVariable,
]);

// Uniforms
gpgpu.particlesVariable.material.uniforms.uTime = new THREE.Uniform(0); // temps écoulé
gpgpu.particlesVariable.material.uniforms.uDeltaTime = new THREE.Uniform(0); // temps écoulé entre 2 frames
gpgpu.particlesVariable.material.uniforms.uBase = new THREE.Uniform(
	baseParticlesTexture, // Texture de base => positions initiales
);
gpgpu.particlesVariable.material.uniforms.uFlowFieldInfluence =
	new THREE.Uniform(0.5);
gpgpu.particlesVariable.material.uniforms.uFlowFieldStrength =
	new THREE.Uniform(2);
gpgpu.particlesVariable.material.uniforms.uFlowFieldFrequency =
	new THREE.Uniform(0.5);
gpgpu.particlesVariable.material.uniforms.uTimeMultiplier = new THREE.Uniform(
	1,
);
gpgpu.particlesVariable.material.uniforms.uDecaySpeed = new THREE.Uniform(0.3);

gpgpu.particlesVariable.material.uniforms.uFlowDirectionX = new THREE.Uniform(
	0.0,
);
gpgpu.particlesVariable.material.uniforms.uFlowDirectionY = new THREE.Uniform(
	0.0,
);
gpgpu.particlesVariable.material.uniforms.uFlowDirectionZ = new THREE.Uniform(
	0.0,
);

// Init
gpgpu.computation.init();

// Debug
gpgpu.debug = new THREE.Mesh(
	new THREE.PlaneGeometry(3, 3),
	new THREE.MeshBasicMaterial({
		// Sur le plan, on va mapper la texture du FBO
		map: gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable)
			.texture,
	}),
);
gpgpu.debug.visible = false;
gpgpu.debug.position.x = 6;
scene.add(gpgpu.debug);

/**
 * Particles
 */
const particles = {};

// Geometry
// Il faut recréer un système de UV coords pour les particules pour les faire correspondre à notre texture
// La coord sera placée au centre du pixel de la texture (par ex. en 0.5, 0.5 pour la première, pas 0.0, 0.0)
const particlesUVArray = new Float32Array(baseGeometry.count * 2);
const sizesArray = new Float32Array(baseGeometry.count);

// On va mapper chaque point sur l'axe vertical puis horizontal de la texture
for (let y = 0; y < gpgpu.size; y++) {
	for (let x = 0; x < gpgpu.size; x++) {
		const i = y * gpgpu.size + x;
		const i2 = i * 2;

		// On positionne au milieu du pixel
		const uvX = (x + 0.5) / gpgpu.size;
		const uvY = (y + 0.5) / gpgpu.size;

		particlesUVArray[i2 + 0] = uvX;
		particlesUVArray[i2 + 1] = uvY;

		// Taille random
		sizesArray[i] = Math.random();
	}
}

// Créer un bufferGeometry pour contenir la position de toutes les particules
particles.geometry = new THREE.BufferGeometry();
// Et lui indiquer le nombre de particules à contenir
particles.geometry.setDrawRange(0, baseGeometry.count);
particles.geometry.setAttribute(
	"aParticlesUV",
	new THREE.BufferAttribute(particlesUVArray, 2),
);
particles.geometry.setAttribute(
	"aColor",
	baseGeometry.instance.attributes.color,
);
particles.geometry.setAttribute(
	"aSize",
	new THREE.BufferAttribute(sizesArray, 1),
);

// Material
particles.material = new THREE.ShaderMaterial({
	vertexShader: particlesVertexShader,
	fragmentShader: particlesFragmentShader,
	uniforms: {
		uSize: new THREE.Uniform(0.08),
		uResolution: new THREE.Uniform(
			new THREE.Vector2(
				sizes.width * sizes.pixelRatio,
				sizes.height * sizes.pixelRatio,
			),
		),
		uParticlesTexture: new THREE.Uniform(),
	},
});

// Points
particles.points = new THREE.Points(particles.geometry, particles.material);
particles.points.frustumCulled = false;
scene.add(particles.points);

/**
 * Tweaks
 */
gui.addColor(debugObject, "clearColor").onChange(() => {
	renderer.setClearColor(debugObject.clearColor);
});
const guiParticules = gui.addFolder("Particules");
guiParticules
	.add(particles.material.uniforms.uSize, "value")
	.min(0)
	.max(1)
	.step(0.001)
	.name("Taille");
guiParticules
	.add(gpgpu.particlesVariable.material.uniforms.uFlowFieldInfluence, "value")
	.min(0)
	.max(1)
	.step(0.01)
	.name("Influence du Flow Field");
guiParticules
	.add(gpgpu.particlesVariable.material.uniforms.uFlowFieldStrength, "value")
	.min(0)
	.max(10)
	.step(0.01)
	.name("Force du Flow Field");
guiParticules
	.add(gpgpu.particlesVariable.material.uniforms.uFlowFieldFrequency, "value")
	.min(0)
	.max(1)
	.step(0.001)
	.name("Fréquence du Flow Field");
guiParticules
	.add(gpgpu.particlesVariable.material.uniforms.uDecaySpeed, "value")
	.min(0)
	.max(5)
	.step(0.01)
	.name("Vitesse de vieillissement");
const guiFlowDirection = gui.addFolder("Flow Direction");
guiFlowDirection
	.add(gpgpu.particlesVariable.material.uniforms.uFlowDirectionX, "value")
	.min(-10)
	.max(10)
	.step(0.01)
	.name("Flow Direction X");
guiFlowDirection
	.add(gpgpu.particlesVariable.material.uniforms.uFlowDirectionY, "value")
	.min(-10)
	.max(10)
	.step(0.01)
	.name("Flow Direction Y");
guiFlowDirection
	.add(gpgpu.particlesVariable.material.uniforms.uFlowDirectionZ, "value")
	.min(-10)
	.max(10)
	.step(0.01)
	.name("Flow Direction Z");
const guiDebug = gui.addFolder("Debug");
guiDebug.add(gpgpu.debug, "visible").name("Voir debug");

/**
 * Animate
 */
const clock = new THREE.Clock();
let previousTime = 0;

const tick = () => {
	const elapsedTime = clock.getElapsedTime();
	const deltaTime = elapsedTime - previousTime;
	previousTime = elapsedTime;

	// Update controls
	controls.update();

	// GPGPU update
	// On update les uniforms de temps avant de calculer la texture
	gpgpu.particlesVariable.material.uniforms.uTime.value = elapsedTime;
	gpgpu.particlesVariable.material.uniforms.uDeltaTime.value = deltaTime;

	gpgpu.computation.compute();
	// Puisqu'on ne peut pas lire et écrire en même temps, on doit update la texture à chaque frame à la main, sinon la texture observée reste la même
	particles.material.uniforms.uParticlesTexture.value =
		gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable).texture;

	// Render normal scene
	renderer.render(scene, camera);

	// Call tick again on the next frame
	window.requestAnimationFrame(tick);
};

tick();
