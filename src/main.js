/* src/main.js */
import './style.css';
import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { createNoise2D } from 'simplex-noise';
import { io } from 'socket.io-client';
import { PlayerModel } from './PlayerModel.js';

document.getElementById('btn-offline').addEventListener('click', () => startGame('offline', 'freeroam'));
document.getElementById('btn-online-freeroam').addEventListener('click', () => startGame('online', 'freeroam'));
document.getElementById('btn-online-tag').addEventListener('click', () => startGame('online', 'tag'));
document.getElementById('btn-online-paintball').addEventListener('click', () => startGame('online', 'paintball'));
document.getElementById('btn-online-dodgeball').addEventListener('click', () => startGame('online', 'dodgeball'));

function startGame(mode, gameType) {
    let serverCode = '';
    const codeInput = document.getElementById('server-code');
    if (codeInput && mode === 'online') {
        serverCode = codeInput.value.trim();
    }
    
    document.getElementById('main-menu').style.display = 'none';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.02);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const cameraGroup = new THREE.Group();
    cameraGroup.position.set(Math.random() * 20 - 10, 1.6, Math.random() * 20 - 10);
    cameraGroup.add(camera);
    scene.add(cameraGroup);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 200, 50);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    let getGroundHeight = (x, z) => 0;
    let worldBuilt = false;
    let chunkMap = {};
    const chunkSize = 100;
    const viewDistance = 2; // grid of 5x5 chunks around player
    let variationNoise;

    function buildWorld(seed) {
        if (worldBuilt) return;
        worldBuilt = true;

        if (gameType === 'dodgeball') {
            getGroundHeight = (x, z) => 0; // Flat arena
            
            const floorGeo = new THREE.PlaneGeometry(100, 100);
            const floorMat = new THREE.MeshStandardMaterial({ color: 0x995533, roughness: 0.9, metalness: 0.1 });
            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI / 2;
            scene.add(floor);
            
            // Arena walls (glass-like)
            const wallMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.3 });
            const wallGeo1 = new THREE.BoxGeometry(100, 10, 1);
            const wallGeo2 = new THREE.BoxGeometry(1, 10, 100);
            const w1 = new THREE.Mesh(wallGeo1, wallMat); w1.position.set(0, 5, -50); scene.add(w1);
            const w2 = new THREE.Mesh(wallGeo1, wallMat); w2.position.set(0, 5, 50); scene.add(w2);
            const w3 = new THREE.Mesh(wallGeo2, wallMat); w3.position.set(-50, 5, 0); scene.add(w3);
            const w4 = new THREE.Mesh(wallGeo2, wallMat); w4.position.set(50, 5, 0); scene.add(w4);
            
            // Constrain players to arena
            cameraGroup.position.set(Math.random() * 80 - 40, 1.6, Math.random() * 80 - 40);
        } else {
            function mulberry32(a) {
                return function() {
                  let t = a += 0x6D2B79F5;
                  t = Math.imul(t ^ t >>> 15, t | 1);
                  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
                  return ((t ^ t >>> 14) >>> 0) / 4294967296;
                }
            }
            
            // Randomize global theme based on seed
            // We hash the seed slightly differently to ensure distribution
            const pRNG = mulberry32((seed * 1.5) + 8888);
            const themeRoll = pRNG();
            window.worldTheme = 'grass';
            if (themeRoll < 0.20) window.worldTheme = 'desert';
            else if (themeRoll < 0.40) window.worldTheme = 'snow';
            
            // Update UI to reflect the map biome
            const uiLayer = document.getElementById('ui-layer');
            if (uiLayer) {
                uiLayer.innerHTML = uiLayer.innerHTML.replace('</h3>', ` - ${window.worldTheme.toUpperCase()} MAP</h3>`);
            }

            const elevationNoise = createNoise2D(mulberry32(seed));
            variationNoise = createNoise2D(mulberry32(seed + 1234));

            getGroundHeight = (x, z) => {
                return elevationNoise(x * 0.05, -z * 0.05) * 3 + elevationNoise(x * 0.01, -z * 0.01) * 10;
            };

            // Seed initial chunks around spawn
            updateChunks(cameraGroup.position.x, cameraGroup.position.z);
        }
    }

    function generateChunk(cx, cz) {
        const geo = new THREE.PlaneGeometry(chunkSize, chunkSize, 40, 40);
        const posAttr = geo.attributes.position;
        const colors = [];
        const offsetX = cx * chunkSize;
        const offsetZ = cz * chunkSize;
        
        for (let i = 0; i < posAttr.count; i++) {
            const lx = posAttr.getX(i);
            const ly = posAttr.getY(i);
            const wx = lx + offsetX; 
            const wz = -ly + offsetZ; // flip Y for Z
            
            const z = getGroundHeight(wx, wz);
            posAttr.setZ(i, z);
            
            const v = variationNoise(wx * 0.05, wz * 0.05);
            
            let r, g, b;
            
            if (z < -4.5) { 
                if (window.worldTheme === 'snow') {
                    r=0.7; g=0.8; b=0.9;
                } else if (window.worldTheme === 'desert') {
                    r=0.9; g=0.8; b=0.6; // sand
                } else {
                    r=0.1 + (v * 0.05); g=0.4 + (v * 0.05); b=0.1; // grass map water basin is purely mud/green
                }
            } else if (window.worldTheme === 'desert') {
                r=0.8 + (v * 0.05); g=0.55 + (v * 0.05); b=0.25;
            } else if (window.worldTheme === 'snow') {
                r=0.9 + (v * 0.05); g=0.9 + (v * 0.05); b=0.9 + (v * 0.05);
            } else {
                r=0.15 + (v * 0.05); g=0.45 + (v * 0.05); b=0.15;
            }
            colors.push(r, g, b);
        }
        
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(offsetX, 0, offsetZ);
        scene.add(mesh);
        return mesh;
    }

    function updateChunks(playerX, playerZ) {
        if (gameType === 'dodgeball') return;
        if (!worldBuilt) return;

        const currentCx = Math.round(playerX / chunkSize);
        const currentCz = Math.round(playerZ / chunkSize);

        const neededChunks = new Set();
        
        for (let dx = -viewDistance; dx <= viewDistance; dx++) {
            for (let dz = -viewDistance; dz <= viewDistance; dz++) {
                const cx = currentCx + dx;
                const cz = currentCz + dz;
                const key = `${cx},${cz}`;
                neededChunks.add(key);
                
                if (!chunkMap[key]) {
                    chunkMap[key] = generateChunk(cx, cz);
                }
            }
        }

        // Cleanup out-of-bounds chunks
        for (let key in chunkMap) {
            if (!neededChunks.has(key)) {
                const mesh = chunkMap[key];
                scene.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
                delete chunkMap[key];
            }
        }
    }

    if (mode === 'offline') {
        buildWorld(Math.floor(Math.random() * 1000000));
    }

    const keys = { w: false, a: false, s: false, d: false, arrowleft: false, arrowright: false, arrowup: false, arrowdown: false, shift: false, v: false, space: false };
    let isThirdPerson = false;
    let localPlayerModel = null;
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.location.reload();
            return;
        }

        const k = e.key.toLowerCase();
        if (e.code === 'Space') keys.space = true;
        if (k === 'shift') keys.shift = true;
        if (keys.hasOwnProperty(k)) keys[k] = true;
        
        if (k === 'v' && !isEliminated) {
            isThirdPerson = !isThirdPerson;
            if (localPlayerModel && localPlayerModel.userData.model) {
                localPlayerModel.userData.model.head.visible = isThirdPerson;
            }
            if (isThirdPerson) {
                camera.position.set(0, 1.5, 3.5);
                camera.lookAt(0, 0, 0); 
            } else {
                camera.position.set(0, 0, 0);
                camera.rotation.set(0, 0, 0);
            }
        }
        
        if (e.code === 'Space' && (gameType === 'paintball' || gameType === 'dodgeball') && mode === 'online' && canShoot) {
            shootPaintball();
        }
        
        if (e.code === 'KeyT' && gameType === 'tag' && mode === 'online' && socket) {
            socket.emit('becomeIt');
        }
    });
    window.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        if (e.code === 'Space') keys.space = false;
        if (k === 'shift') keys.shift = false;
        if (keys.hasOwnProperty(k)) keys[k] = false;
    });

    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    document.addEventListener('mousedown', (e) => {
        if(e.button === 0) isDragging = true;
        if (e.button === 0 && (gameType === 'paintball' || gameType === 'dodgeball') && mode === 'online' && canShoot && !isEliminated) {
            shootPaintball();
        }
    });

    document.addEventListener('mouseup', () => isDragging = false);
    
    document.addEventListener('touchstart', (e) => {
        isDragging = true;
        if ((gameType === 'paintball' || gameType === 'dodgeball') && mode === 'online' && canShoot && !isEliminated) {
            shootPaintball();
        }
    });
    document.addEventListener('touchend', () => isDragging = false);
    document.addEventListener('mousemove', (e) => {
        if (isDragging && !renderer.xr.isPresenting) {
            const deltaX = e.clientX - previousMousePosition.x;
            const deltaY = e.clientY - previousMousePosition.y;
            cameraGroup.rotation.y -= deltaX * 0.005;
            camera.rotation.x -= deltaY * 0.005;
            camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
        }
        previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    // Multiplayer State
    let socket = null;
    const otherPlayers = {};
    let localItId = null;
    let score = 0;
    const paintballs = [];
    let canShoot = true;
    let isEliminated = false;
    
    // Ability State
    const moveSpeed = 8;
    let dashCooldown = 0;
    let dashTime = 0;
    let verticalVelocity = 0;
    const gravity = 25; // 25 units/s^2 down
    const jumpForce = 12; // Initial jump velocity
    let isGrounded = true;

    // UI
    const uiDiv = document.createElement('div');
    uiDiv.id = 'ui-layer';
    document.body.appendChild(uiDiv);
    
    // Crosshair for Paintball/Dodgeball
    if (gameType === 'paintball' || gameType === 'dodgeball') {
        const crosshair = document.createElement('div');
        crosshair.style.position = 'absolute';
        crosshair.style.top = '50%';
        crosshair.style.left = '50%';
        crosshair.style.width = '10px';
        crosshair.style.height = '10px';
        crosshair.style.backgroundColor = 'white';
        crosshair.style.borderRadius = '50%';
        crosshair.style.transform = 'translate(-50%, -50%)';
        crosshair.style.pointerEvents = 'none';
        crosshair.style.zIndex = '100';
        document.body.appendChild(crosshair);
    }
    
    const updateUI = () => {
        if (mode === 'offline') {
            uiDiv.innerHTML = `<h3>True Exploration : OFFLINE</h3><p>WASD & Controller Support / Shift to Dash / V for Third Person</p>`;
            return;
        }
        let txt = `<h3>True Exploration : ${gameType.toUpperCase()} ${mode === 'online' ? (serverCode ? `(Private: ${serverCode})` : '(Public)') : ''}</h3>`;
        if (isEliminated) {
            txt += `<h4 style="color:red; text-shadow: 2px 2px 0px #000;">YOU WERE ELIMINATED!</h4>`;
        }
        
        if (gameType === 'tag') {
            txt += `<p>${socket && socket.id === localItId ? '<span style="color:red; font-weight:bold; font-size:1.5em; text-shadow: 2px 2px 0px #000;">YOU ARE IT!</span><br/>(ESP Vision Enabled)' : 'Run away from IT!'}<br/>(Press 'T' to forcefully become IT)<br/>Shift to Dash</p>`;
        } else if (gameType === 'paintball' || gameType === 'dodgeball') {
            txt += `<p>Score: ${score}<br/>Press Space or Click to shoot!</p>`;
        }
        uiDiv.innerHTML = txt;
    };
    updateUI();

    const localIndicator = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.5, 32),
        new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide })
    );
    localIndicator.position.set(0, -1.5, 0); // At feet
    localIndicator.rotation.x = -Math.PI / 2;
    localIndicator.visible = false;
    cameraGroup.add(localIndicator);

    const createPlayerMesh = () => {
        const randColor = Math.random() * 0xffffff;
        const playerModel = new PlayerModel(randColor);
        playerModel.group.userData.model = playerModel;
        return playerModel.group;
    };

    localPlayerModel = createPlayerMesh();
    localPlayerModel.userData.model.head.visible = false; // Hidden in FP
    cameraGroup.add(localPlayerModel);

    function shootPaintball() {
        if (!socket || !socket.connected || isEliminated) return;
        canShoot = false;
        setTimeout(() => canShoot = true, 400); // Fire rate limiting
        
        const vel = new THREE.Vector3();
        camera.getWorldDirection(vel);
        vel.normalize().multiplyScalar(35);
        
        const pos = new THREE.Vector3();
        camera.getWorldPosition(pos);
        
        const data = { position: pos, velocity: vel, owner: socket.id };
        spawnPaintball(data);
        socket.emit('shootPaintball', data);
    }
    
    function spawnPaintball(data) {
        const geo = new THREE.SphereGeometry(0.2, 8, 8);
        const mat = new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff, emissive: 0x222222 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(data.position);
        mesh.userData = { velocity: new THREE.Vector3().copy(data.velocity), owner: data.owner, life: 3.0 };
        scene.add(mesh);
        paintballs.push(mesh);
    }

    if (mode === 'online') {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        socket = io(isLocal ? `http://${window.location.hostname}:3001` : window.location.origin);
        
        socket.on('connect', () => {
            socket.emit('joinMode', { mode: gameType, serverCode });
        });

        socket.on('roomInit', (data) => {
            buildWorld(data.seed);
        });

        socket.on('currentPlayers', (players) => {
            Object.keys(players).forEach(id => {
                if (id !== socket.id && !otherPlayers[id]) {
                    const mesh = createPlayerMesh();
                    mesh.position.copy(players[id].position);
                    if (players[id].rotation) mesh.rotation.y = players[id].rotation.y;
                    if (players[id].status === 'eliminated') mesh.visible = false;
                    scene.add(mesh);
                    otherPlayers[id] = mesh;
                }
            });
        });
        
        socket.on('playerConnected', (playerInfo) => {
            if (playerInfo.id !== socket.id && !otherPlayers[playerInfo.id]) {
                const mesh = createPlayerMesh();
                mesh.position.copy(playerInfo.position);
                if (playerInfo.rotation) mesh.rotation.y = playerInfo.rotation.y;
                scene.add(mesh);
                otherPlayers[playerInfo.id] = mesh;
            }
        });
        
        socket.on('playerDisconnected', (id) => {
            if (otherPlayers[id]) {
                scene.remove(otherPlayers[id]);
                delete otherPlayers[id];
            }
        });
        
        socket.on('playerMoved', (playerInfo) => {
            if (otherPlayers[playerInfo.id]) {
                otherPlayers[playerInfo.id].position.copy(playerInfo.position);
                if (playerInfo.rotation) {
                    otherPlayers[playerInfo.id].rotation.y = playerInfo.rotation.y;
                }
            }
        });

        // Tag Logic & "It" ESP
        socket.on('newIt', (itId) => {
            localItId = itId;
            const amIIt = (socket.id === itId);
            localIndicator.visible = amIIt;
            updateUI();
            
            Object.keys(otherPlayers).forEach(id => {
                const pGroup = otherPlayers[id];
                const model = pGroup.userData.model;
                if (!model) return;
                
                model.meshes.forEach(pMesh => {
                    if (id === itId) {
                        pMesh.material.color.setHex(0xff0000);
                        pMesh.material.emissive.setHex(0x550000);
                        pMesh.material.depthTest = true;
                        pMesh.renderOrder = 0;
                    } else {
                        pMesh.material.color.setHex(model.originalColor);
                        pMesh.material.emissive.setHex(0x000000);
                        
                        if (amIIt) { // ESP Vision active
                            pMesh.material.depthTest = false;
                            pMesh.material.transparent = true;
                            pMesh.material.opacity = 0.8;
                            pMesh.renderOrder = 999;
                        } else { // Normal Display
                            pMesh.material.depthTest = true;
                            pMesh.material.transparent = false;
                            pMesh.material.opacity = 1.0;
                            pMesh.renderOrder = 0;
                        }
                    }
                });
            });
        });

        socket.on('spawnPaintball', (data) => spawnPaintball(data));
        
        socket.on('playerHit', (hitId) => {
            if (hitId === socket.id) {
                document.body.style.backgroundColor = "red";
                setTimeout(() => document.body.style.backgroundColor = "black", 150);
            } else if (otherPlayers[hitId]) {
                const pGroup = otherPlayers[hitId];
                if (pGroup.userData.model) {
                    const newColor = Math.random() * 0xffffff;
                    pGroup.userData.model.meshes.forEach(m => m.material.color.setHex(newColor));
                }
            }
        });
        
        socket.on('scoreUpdate', (scores) => {
            if (scores[socket.id] !== undefined) {
                score = scores[socket.id];
                updateUI();
            }
        });
        
        // Dodgeball logic
        socket.on('playerEliminated', (id) => {
            if (id === socket.id) {
                isEliminated = true;
                updateUI();
            } else if (otherPlayers[id]) {
                otherPlayers[id].visible = false;
            }
        });
        
        socket.on('roundOver', (winnerId) => {
            if (winnerId === socket.id) {
                uiDiv.innerHTML = `<h3 style="color:gold; font-size: 2em">YOU WON THE ROUND!</h3><p>New round starts soon...</p>`;
            } else {
                uiDiv.innerHTML = `<h3 style="color:gray">ROUND OVER</h3><p>New round starts soon...</p>`;
            }
        });
        
        socket.on('roundStart', () => {
            isEliminated = false;
            // Spawn at random location again
            if (gameType === 'dodgeball') {
                cameraGroup.position.set(Math.random() * 80 - 40, 1.6, Math.random() * 80 - 40);
            } else {
                cameraGroup.position.set(Math.random() * 20 - 10, 1.6, Math.random() * 20 - 10);
            }
            
            Object.keys(otherPlayers).forEach(id => otherPlayers[id].visible = true);
            updateUI();
        });
    }

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    const clock = new THREE.Clock();
    let lastUpdate = 0;

    renderer.setAnimationLoop(() => {
        const dt = clock.getDelta();
        
        // Update all other players' animations
        Object.values(otherPlayers).forEach(pGroup => {
            if (pGroup.userData.model) {
                pGroup.userData.model.update(dt, pGroup.position);
            }
        });

        if (dashCooldown > 0) dashCooldown -= dt;
        if (dashTime > 0) dashTime -= dt;

        const isIt = gameType === 'tag' && socket && socket.id === localItId;
        let currentSpeed = isIt ? moveSpeed * 1.3 : moveSpeed;

        const direction = new THREE.Vector3();
        if (keys.w) direction.z -= 1;
        if (keys.s) direction.z += 1;
        if (keys.a) direction.x -= 1;
        if (keys.d) direction.x += 1;

        const lookSpeed = 2; 
        if (keys.arrowleft && !isEliminated) cameraGroup.rotation.y += lookSpeed * dt;
        if (keys.arrowright && !isEliminated) cameraGroup.rotation.y -= lookSpeed * dt;
        if (keys.arrowup && !isEliminated) camera.rotation.x += lookSpeed * dt;
        if (keys.arrowdown && !isEliminated) camera.rotation.x -= lookSpeed * dt;

        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < gamepads.length; i++) {
            const gp = gamepads[i];
            if (gp && !isEliminated) {
                if (Math.abs(gp.axes[0]) > 0.1) direction.x += gp.axes[0];
                if (Math.abs(gp.axes[1]) > 0.1) direction.z += gp.axes[1];
                if (Math.abs(gp.axes[2]) > 0.1) cameraGroup.rotation.y -= gp.axes[2] * dt * 2;
                if (Math.abs(gp.axes[3]) > 0.1) camera.rotation.x -= gp.axes[3] * dt * 2;
                
                if ((gameType === 'paintball' || gameType === 'dodgeball') && mode === 'online' && gp.buttons[7] && gp.buttons[7].pressed && canShoot) {
                    shootPaintball();
                }
                
                // Gamepad Dash (B button)
                if (gp.buttons[1]?.pressed && dashCooldown <= 0 && direction.lengthSq() > 0 && !isIt) {
                    dashTime = 0.2;
                    dashCooldown = 2.0;
                }
                
                // Gamepad Jump (A button)
                if (gp.buttons[0]?.pressed && isGrounded && !isEliminated) {
                     verticalVelocity = jumpForce;
                     isGrounded = false;
                }
            }
        }

        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));

        if (direction.lengthSq() > 0 && !isEliminated) {
            direction.normalize();
            
            updateChunks(cameraGroup.position.x, cameraGroup.position.z);
            
            if (keys.shift && dashCooldown <= 0 && !isIt) {
                dashTime = 0.2; // Dash for 200ms
                dashCooldown = 2.0;
            }
            if (isIt) dashTime = 0;
            if (dashTime > 0) currentSpeed = moveSpeed * 5; // 5x speed boost

            const moveVector = new THREE.Vector3(direction.x, 0, direction.z);
            moveVector.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraGroup.rotation.y);    
            cameraGroup.position.addScaledVector(moveVector, currentSpeed * dt);
            
            // Enforce Arena bounds for dodgeball
            if (gameType === 'dodgeball') {
                cameraGroup.position.x = Math.max(-49, Math.min(49, cameraGroup.position.x));
                cameraGroup.position.z = Math.max(-49, Math.min(49, cameraGroup.position.z));
            }
        }

        verticalVelocity -= gravity * dt;
        cameraGroup.position.y += verticalVelocity * dt;

        const groundY = getGroundHeight(cameraGroup.position.x, cameraGroup.position.z) + 1.6;
        if (cameraGroup.position.y <= groundY) {
            cameraGroup.position.y = groundY;
            verticalVelocity = 0;
            isGrounded = true;
        } else {
            isGrounded = false;
        }

        if (keys.space && isGrounded && !isEliminated) {
            verticalVelocity = jumpForce;
            isGrounded = false;
        }
        
        if (localPlayerModel) {
            localPlayerModel.visible = !isEliminated;
        }

        if (localPlayerModel && !isEliminated) {
            if (!localPlayerModel.userData.fakePos) localPlayerModel.userData.fakePos = new THREE.Vector3();
            if (direction.lengthSq() > 0) {
                 localPlayerModel.userData.fakePos.x += currentSpeed * dt;
            }
            localPlayerModel.userData.model.update(dt, localPlayerModel.userData.fakePos);
            
            // Shift body down slightly for First Person view perspective
            localPlayerModel.position.set(0, -1.0, 0);
        }

        if (gameType === 'paintball' || gameType === 'dodgeball') {
            for (let i = paintballs.length - 1; i >= 0; i--) {
                const pb = paintballs[i];
                pb.position.addScaledVector(pb.userData.velocity, dt);
                pb.userData.velocity.y -= 9.8 * dt; // Gravity
                pb.userData.life -= dt;
                
                let hitPlayer = false;
                if (pb.userData.owner === (socket ? socket.id : null) && !isEliminated) {
                    for (let id in otherPlayers) {
                        if (otherPlayers[id].visible && pb.position.distanceTo(otherPlayers[id].position) < 1.5) {
                            if (socket) socket.emit('registerHit', id);
                            hitPlayer = true;
                            break;
                        }
                    }
                }
                
                if (pb.userData.life <= 0 || pb.position.y < getGroundHeight(pb.position.x, pb.position.z) || hitPlayer) {
                    scene.remove(pb);
                    paintballs.splice(i, 1);
                }
            }
        }

        if (socket && socket.connected && !isEliminated) {
            const now = clock.getElapsedTime();
            if (now - lastUpdate > 0.1) {
                socket.emit('playerMovement', { 
                    position: { x: cameraGroup.position.x, y: cameraGroup.position.y, z: cameraGroup.position.z }, 
                    rotation: { x: 0, y: cameraGroup.rotation.y, z: 0 } 
                });
                lastUpdate = now;
            }
        }

        renderer.render(scene, camera);
    });
}
