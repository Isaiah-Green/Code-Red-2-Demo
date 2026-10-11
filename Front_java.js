// 1. Scene Setup
const scene = new THREE.Scene();

// ---------- Orthographic Camera & Frustum ----------
const viewSize = 120;
function frustum() {
  const aspect = window.innerWidth / window.innerHeight;
  return {
    left: (-viewSize * aspect) / 2,
    right: (viewSize * aspect) / 2,
    top: viewSize / 2,
    bottom: -viewSize / 2,
  };
}
const f = frustum();
const camera = new THREE.OrthographicCamera(
  f.left,
  f.right,
  f.top,
  f.bottom,
  0.1,
  1000,
);
// Tilted top-down angle so orbits read clearly
camera.position.set(0, 70, 60);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ---------- Orbit Controls Setup ----------
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 0);

// ---------- Starfield Background ----------
const starCount = 1500;
const starPositions = new Float32Array(starCount * 3);
const starColors = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  starPositions[i * 3] = (Math.random() - 0.5) * viewSize * 3.4;
  starPositions[i * 3 + 1] = (Math.random() - 0.5) * viewSize * 2;
  starPositions[i * 3 + 2] = -(150 + Math.random() * 300);
  const b = 0.35 + Math.random() * 0.65;
  starColors[i * 3] = starColors[i * 3 + 1] = starColors[i * 3 + 2] = b;
}
const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(starPositions, 3),
);
starGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
const starMaterial = new THREE.PointsMaterial({
  size: 1.6,
  sizeAttenuation: false,
  vertexColors: true,
});
const stars = new THREE.Points(starGeometry, starMaterial);
camera.add(stars);
scene.add(camera);

// ---------- Physics & Bodies Setup ----------
const G = 1.0;
const SOFTENING = 0.01; // small, so it barely weakens the sun's pull
const FIXED_DT = 1 / 240; // physics timestep (seconds)
const SPIN_SPEED = 1.2; // planet self-rotation in radians per second
const SUN_SPIN_SPEED = 0.3; // sun self-rotation in radians per second
let bodies = [];
let userSpawnedMeshes = [];
let userSpawnedRings = [];
let isPaused = false;

// Selection tracking variables
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedBody = null;

function createBody(
  mesh,
  position,
  velocity,
  mass,
  name,
  isStatic = false,
  isUserSpawned = false,
) {
  mesh.position.copy(position);
  scene.add(mesh);

  const bodyObj = {
    name: name,
    mesh: mesh,
    position: position.clone(),
    velocity: velocity.clone(),
    acceleration: new THREE.Vector3(0, 0, 0),
    initialPosition: position.clone(), // used by Reset
    initialVelocity: velocity.clone(), // used by Reset
    mass: mass,
    isStatic: isStatic,
    isUserSpawned: isUserSpawned,
  };

  // Attach physics object reference to mesh for raycasting lookup
  mesh.userData.bodyRef = bodyObj;

  bodies.push(bodyObj);
  if (isUserSpawned) {
    userSpawnedMeshes.push(mesh);
  }
  return bodyObj;
}

// Builds an elliptical orbit track. The sun sits at one focus (the origin)
// and the planet starts at perihelion (closest point) on the +x axis.
// eccentricity: 0 = perfect circle, closer to 1 = more stretched.
// rotationY (radians) turns the whole ellipse around the sun, so perihelion
// can point in any direction instead of always along +x.
function createOrbitLine(semiMajor, eccentricity, color, rotationY = 0) {
  const semiMinor = semiMajor * Math.sqrt(1 - eccentricity * eccentricity);
  const centerX = -semiMajor * eccentricity; // ellipse center is offset from the sun
  const points = [];
  const pointCount = 256;
  for (let i = 0; i < pointCount; i++) {
    const t = (i / pointCount) * Math.PI * 2;
    points.push(
      new THREE.Vector3(
        centerX + semiMajor * Math.cos(t),
        0,
        semiMinor * Math.sin(t),
      ),
    );
  }
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: color }),
  );
  line.rotation.y = rotationY;
  scene.add(line);
  return line;
}

// Helper to build a wireframe sphere on an elliptical orbit with its track.
// semiMajor = average orbit size, eccentricity = how stretched the ellipse is.
function addPlanetWithOrbit(
  name,
  radius,
  segments,
  color,
  semiMajor,
  eccentricity,
  mass,
) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, segments, segments),
    new THREE.MeshBasicMaterial({ color: color, wireframe: true }),
  );

  // Start at perihelion, moving at the speed that produces this exact ellipse
  const sunMass = bodies[0].mass;
  const perihelion = semiMajor * (1 - eccentricity);
  const perihelionSpeed = Math.sqrt(
    (G * sunMass * (1 + eccentricity)) / perihelion,
  );

  createBody(
    mesh,
    new THREE.Vector3(perihelion, 0, 0),
    new THREE.Vector3(0, 0, perihelionSpeed),
    mass,
    name,
    false,
    false,
  );

  createOrbitLine(semiMajor, eccentricity, 0x444444);
}

// --- Create Sun (Static Anchor at Center) ---
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(5, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xffcc00, wireframe: true }),
);
createBody(
  sunMesh,
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, 0),
  1000,
  "Sun",
  true,
  false,
);

// --- Create Base Planets with Balanced Orbital Velocities ---
// Planet masses are small compared with the sun (1000) so planets
// barely tug on each other and stay on their orbit rings.
// Mars's orbit shape is shared with the spawn code so new planets can
// stay outside it.
const MARS_SEMI_MAJOR = 36;
const MARS_ECCENTRICITY = 0.15;

// Args: name, radius, segments, color, semiMajor, eccentricity, mass
// Eccentricities are exaggerated so the ellipses are easy to see, and
// chosen so the orbits don't overlap each other.
addPlanetWithOrbit("Mercury", 1, 16, 0xaaaaaa, 12, 0.2, 0.01);
addPlanetWithOrbit("Venus", 1.5, 16, 0xe3bb76, 19, 0.05, 0.02);
addPlanetWithOrbit("Earth", 2, 16, 0x2233ff, 28, 0.07, 0.03);
addPlanetWithOrbit(
  "Mars",
  1.3,
  16,
  0xd15226,
  MARS_SEMI_MAJOR,
  MARS_ECCENTRICITY,
  0.015,
);

// ---------- Spawning Function for User Button ----------
let spawnCounter = 1;
// Spawn settings. Planets spawn just outside Mars's orbit ellipse, and the
// whole orbit is checked so it never dips inside it.
const SPAWN_MIN_GAP = 3; // minimum distance kept outside Mars's orbit (units)
const SPAWN_MAX_GAP = 12; // how far beyond Mars's orbit it can spawn at that angle
const SPAWN_MAX_ECCENTRICITY = 0.3;
const SPAWN_MIN_MASS = 0.5; // heavy enough to noticeably tug on the inner planets
const SPAWN_MAX_MASS = 3;
const SPAWN_MAX_TRIES = 100;

// Distance of Mars's orbit from the sun at a given angle (angle 0 = +x axis)
function marsOrbitRadius(angle) {
  return (
    (MARS_SEMI_MAJOR * (1 - MARS_ECCENTRICITY * MARS_ECCENTRICITY)) /
    (1 + MARS_ECCENTRICITY * Math.cos(angle))
  );
}

// True if an orbit (rotated by `rotation`) stays at least SPAWN_MIN_GAP
// outside Mars's orbit at every angle around the sun.
function orbitStaysOutsideMars(semiMajor, eccentricity, rotation) {
  const p = semiMajor * (1 - eccentricity * eccentricity);
  for (let i = 0; i < 360; i++) {
    const angle = (i / 360) * Math.PI * 2; // angle around the sun
    const trueAnomaly = angle - rotation; // measured from this orbit's perihelion
    const r = p / (1 + eccentricity * Math.cos(trueAnomaly));
    if (r < marsOrbitRadius(angle) + SPAWN_MIN_GAP) return false;
  }
  return true;
}

function spawnUserPlanet() {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x00ffcc, wireframe: true }),
  );

  // Pick a random angle, a spawn point just outside Mars's orbit at that
  // angle, and a random ellipse. Retry until the whole orbit stays outside
  // Mars's orbit.
  let angle, perihelion, eccentricity, semiMajor;
  let found = false;
  for (let attempt = 0; attempt < SPAWN_MAX_TRIES && !found; attempt++) {
    angle = Math.random() * Math.PI * 2;
    perihelion =
      marsOrbitRadius(angle) +
      SPAWN_MIN_GAP +
      Math.random() * (SPAWN_MAX_GAP - SPAWN_MIN_GAP);
    eccentricity = Math.random() * SPAWN_MAX_ECCENTRICITY;
    semiMajor = perihelion / (1 - eccentricity);
    found = orbitStaysOutsideMars(semiMajor, eccentricity, angle);
  }
  if (!found) {
    // Fallback: circular orbit just beyond Mars's farthest point
    eccentricity = 0;
    perihelion = MARS_SEMI_MAJOR * (1 + MARS_ECCENTRICITY) + SPAWN_MIN_GAP;
    semiMajor = perihelion;
  }

  // Speed at perihelion that produces exactly this ellipse
  const sunMass = bodies[0].mass;
  const perihelionSpeed = Math.sqrt(
    (G * sunMass * (1 + eccentricity)) / perihelion,
  );

  // Rotating (1,0,0) and (0,0,1) around the y-axis by `angle` gives the
  // start direction and the counter-clockwise travel direction.
  const position = new THREE.Vector3(
    Math.cos(angle) * perihelion,
    0,
    -Math.sin(angle) * perihelion,
  );
  const velocity = new THREE.Vector3(
    Math.sin(angle) * perihelionSpeed,
    0,
    Math.cos(angle) * perihelionSpeed,
  );

  const planetName = `Planet ${spawnCounter++}`;
  const mass =
    SPAWN_MIN_MASS + Math.random() * (SPAWN_MAX_MASS - SPAWN_MIN_MASS);
  createBody(mesh, position, velocity, mass, planetName, false, true);

  // Leapfrog reuses stored accelerations, so refresh them for the new body
  computeAccelerations();

  // Matching elliptical orbit track, rotated to the same angle
  const ring = createOrbitLine(semiMajor, eccentricity, 0x333333, angle);
  userSpawnedRings.push(ring);
}

// ---------- Click-to-Inspect Raycasting Listener ----------
window.addEventListener("click", (event) => {
  // Ignore clicks if clicking on UI buttons
  if (event.target.tagName === "BUTTON") return;

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // Collect all planet meshes from bodies array
  const planetMeshes = bodies.map((b) => b.mesh);
  const intersects = raycaster.intersectObjects(planetMeshes);

  if (intersects.length > 0) {
    // Get the body reference attached to the clicked mesh
    selectedBody = intersects[0].object.userData.bodyRef;
  } else {
    // Clicked empty space clears selection
    selectedBody = null;
    document.getElementById("selected-info").innerHTML =
      "Click a planet to inspect";
  }
});

// ---------- Reset Function ----------
function resetSimulation() {
  userSpawnedMeshes.forEach((mesh) => {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  userSpawnedMeshes = [];

  userSpawnedRings.forEach((ring) => {
    scene.remove(ring);
    ring.geometry.dispose();
    ring.material.dispose();
  });
  userSpawnedRings = [];

  let i = bodies.length;
  while (i--) {
    if (bodies[i].isUserSpawned) {
      bodies.splice(i, 1);
    }
  }

  // Put the sun and the original four planets back at their starting
  // positions and speeds
  bodies.forEach((body) => {
    body.position.copy(body.initialPosition);
    body.velocity.copy(body.initialVelocity);
    body.mesh.position.copy(body.position);
    body.mesh.rotation.y = 0;
  });
  accumulator = 0; // drop any leftover physics time from before the reset

  // Recompute forces for the restored layout
  computeAccelerations();

  selectedBody = null;
  spawnCounter = 1;
  document.getElementById("selected-info").innerHTML =
    "Click a planet to inspect";
}

// Button Event Listeners
document.getElementById("spawn-btn").addEventListener("click", () => {
  spawnUserPlanet();
});

document.getElementById("reset-btn").addEventListener("click", () => {
  resetSimulation();
});

const pauseBtn = document.getElementById("pause-btn");
pauseBtn.addEventListener("click", () => {
  isPaused = !isPaused;
  const img = document.getElementById("pause_play_btn");
  if (img) {
    img.src = isPaused ? "Play Button.png" : "Pause Button.png";
  }
});

// ---------- Gravity Calculation ----------
function calculateGravitationalForce(bodyA, bodyB) {
  const direction = new THREE.Vector3().subVectors(
    bodyB.position,
    bodyA.position,
  );
  const distanceSq = direction.lengthSq() + SOFTENING * SOFTENING;
  const distance = Math.sqrt(distanceSq);

  if (distance === 0) return new THREE.Vector3(0, 0, 0);

  const forceMagnitude = (G * bodyA.mass * bodyB.mass) / distanceSq;
  direction.normalize();
  direction.multiplyScalar(forceMagnitude);

  return direction;
}

// ---------- Acceleration Calculation ----------
function computeAccelerations() {
  bodies.forEach((body) => body.acceleration.set(0, 0, 0));

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const bodyA = bodies[i];
      const bodyB = bodies[j];

      const forceOnA = calculateGravitationalForce(bodyA, bodyB);
      const forceOnB = forceOnA.clone().negate();

      bodyA.acceleration.addScaledVector(forceOnA, 1 / bodyA.mass);
      bodyB.acceleration.addScaledVector(forceOnB, 1 / bodyB.mass);
    }
  }
}

// ---------- Leapfrog (Velocity Verlet) Physics Step ----------
// half-kick -> drift -> recompute forces -> half-kick
function stepPhysics(dt) {
  bodies.forEach((body) => {
    if (body.isStatic) return;
    body.velocity.addScaledVector(body.acceleration, dt / 2);
  });

  bodies.forEach((body) => {
    if (body.isStatic) return;
    body.position.addScaledVector(body.velocity, dt);
  });

  computeAccelerations();

  bodies.forEach((body) => {
    if (body.isStatic) return;
    body.velocity.addScaledVector(body.acceleration, dt / 2);
  });
}

// Initial accelerations so the first half-kick is correct
computeAccelerations();

// ---------- Main Animation Loop ----------
let lastTime = performance.now();
let accumulator = 0;

function animate(currentTime) {
  requestAnimationFrame(animate);

  const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1);
  lastTime = currentTime;

  if (!isPaused) {
    // Run physics in small fixed steps regardless of frame rate
    accumulator += deltaTime;
    while (accumulator >= FIXED_DT) {
      stepPhysics(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    // Sync visuals once per frame and spin the bodies
    bodies.forEach((body) => {
      if (body.isStatic) return;
      body.mesh.position.copy(body.position);
      body.mesh.rotation.y += SPIN_SPEED * deltaTime;
    });
    sunMesh.rotation.y += SUN_SPIN_SPEED * deltaTime;
  }

  // Update UI info box if a planet is selected
  if (selectedBody) {
    const speed = selectedBody.velocity.length().toFixed(2);
    const distance = new THREE.Vector3()
      .subVectors(bodies[0].position, selectedBody.position)
      .length()
      .toFixed(2);
    document.getElementById("selected-info").innerHTML = `
            <strong>${selectedBody.name}</strong><br>
            Velocity: ${speed} units/s <br>
            Distance from the Sun: ${distance * 5342781} Km <br>
          `;
  }

  // Required for OrbitControls damping inertia
  controls.update();

  renderer.render(scene, camera);
}
animate(performance.now());

// ---------- Resize Handling ----------
window.addEventListener("resize", () => {
  const f = frustum();
  camera.left = f.left;
  camera.right = f.right;
  camera.top = f.top;
  camera.bottom = f.bottom;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
