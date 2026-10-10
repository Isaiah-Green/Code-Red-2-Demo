const G = 1.0
const SOFTENING = 0.5
const bodies = []

function spawnBody(mesh, position, velocity, mass, isStatic = false) {
  const newBody = {
    mesh: mesh,
    position: position.clone(),
    velocity: velocity.clone(),
    acceleration: new THREE.Vector3(0, 0, 0),
    mass: mass,
    isStatic: isStatic 
  };


  bodies.push(newBody);
  
  scene.add(mesh);
}
function calculateGForce(bodyA,bodyB){
  const direction = new THREE.Vector3().subVectors(bodyB.position, bodyA.position);
  
  const distanceSq = direction.lengthSq() + (SOFTENING * SOFTENING);
  const distance = Math.sqrt(distanceSq);

  if (distance === 0) return new THREE.Vector3(0, 0, 0);
  const forceMagnitude = (G * bodyA.mass * bodyB.mass) / distanceSq;
  direction.normalize();
  direction.multiplyScalar(forceMagnitude);

  return direction
}
function updatePhys(bodies,deltaTime){

  bodies.forEach(body => body.acceleration.set(0, 0, 0));


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
  bodies.forEach(body => {
    if (body.isStatic) return; 
    body.velocity.addScaledVector(body.acceleration, deltaTime);
    body.position.addScaledVector(body.velocity, deltaTime);
    body.mesh.position.copy(body.position);
  });
}
