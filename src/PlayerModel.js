/* src/PlayerModel.js */
import * as THREE from 'three';

export class PlayerModel {
    constructor(color) {
        this.group = new THREE.Group();
        this.originalColor = color;
        this.group.userData.originalColor = color;
        this.group.userData.isPlayerModel = true;
        
        const skinMat = new THREE.MeshStandardMaterial({ color: 0xffe0bd, roughness: 0.6 });
        const shirtMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.8 });
        const accentMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
        const backpackMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 });
        
        this.meshes = [];
        
        // Rec Room style floating Head
        this.head = new THREE.Group();
        this.head.position.y = 1.0;
        this.group.add(this.head);
        
        const headGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.45, 16);
        const headMesh = new THREE.Mesh(headGeo, skinMat);
        headMesh.castShadow = true;
        this.head.add(headMesh);
        this.meshes.push(headMesh);
        
        // Eyes
        const eyeGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.02, 8);
        eyeGeo.rotateX(Math.PI / 2);
        const leftEye = new THREE.Mesh(eyeGeo, accentMat);
        leftEye.position.set(-0.12, 0.05, 0.28);
        this.head.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, accentMat);
        rightEye.position.set(0.12, 0.05, 0.28);
        this.head.add(rightEye);
        
        // Mouth
        const mouthGeo = new THREE.BoxGeometry(0.12, 0.02, 0.05);
        const mouth = new THREE.Mesh(mouthGeo, accentMat);
        mouth.position.set(0, -0.1, 0.26);
        this.head.add(mouth);

        // Rec Room style floating Torso
        const torsoGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.75, 16);
        torsoGeo.scale(1.2, 1.0, 0.6); // Flatten the Z axis and widen the X axis
        this.torso = new THREE.Mesh(torsoGeo, shirtMat);
        this.torso.position.y = 0.3; // floats lower
        this.torso.castShadow = true;
        this.group.add(this.torso);
        this.meshes.push(this.torso);
        
        // Backpack attached directly to torso
        const packGeo = new THREE.BoxGeometry(0.4, 0.4, 0.2);
        const pack = new THREE.Mesh(packGeo, backpackMat);
        pack.position.set(0, 0, -0.22); // adjusted closer due to flattened torso
        pack.castShadow = true;
        this.torso.add(pack);
        this.meshes.push(pack);
        
        // Floating Hands (no arms!)
        const handGeo = new THREE.SphereGeometry(0.12, 16, 16);
        
        this.leftHand = new THREE.Mesh(handGeo, skinMat);
        this.leftHand.position.set(-0.45, 0.3, 0);
        this.leftHand.castShadow = true;
        this.group.add(this.leftHand);
        this.meshes.push(this.leftHand);
        
        this.rightHand = new THREE.Mesh(handGeo, skinMat);
        this.rightHand.position.set(0.45, 0.3, 0);
        this.rightHand.castShadow = true;
        this.group.add(this.rightHand);
        this.meshes.push(this.rightHand);
        
        // No legs in classic Rec Room models!
        
        this.time = 0;
        this.previousPosition = new THREE.Vector3();
        
        // Store original Y positions for buoyant bobbing
        this.baseHeadY = 1.0;
        this.baseTorsoY = 0.3;
        this.baseHandY = 0.3;
    }
    
    update(deltaTime, currentPosition) {
        const dt = Math.max(0.001, deltaTime);
        
        const p1 = new THREE.Vector2(currentPosition.x, currentPosition.z);
        const p2 = new THREE.Vector2(this.previousPosition.x, this.previousPosition.z);
        const distance = p1.distanceTo(p2);
        
        const speed = distance / dt;
        this.previousPosition.copy(currentPosition);

        // Animate
        if (speed > 1.0) {
            // Walking / Running
            const animSpeed = speed * (p1.distanceTo(p2) > 0.1 ? 1.5 : 0);
            this.time += dt * animSpeed;
            
            // Rec Room Floating Run Animation
            const bounce = Math.abs(Math.sin(this.time * 2)) * 0.15;
            this.head.position.y = this.baseHeadY + bounce;
            this.torso.position.y = this.baseTorsoY + bounce;
            
            // Hands swing physically forward and backward instead of rotating arms
            this.leftHand.position.z = Math.sin(this.time) * 0.4;
            this.leftHand.position.y = this.baseHandY + bounce + Math.cos(this.time) * 0.1;
            
            this.rightHand.position.z = -Math.sin(this.time) * 0.4;
            this.rightHand.position.y = this.baseHandY + bounce - Math.cos(this.time) * 0.1;

        } else {
            // Return to idle smoothly
            this.leftHand.position.z = THREE.MathUtils.lerp(this.leftHand.position.z, 0, dt * 5);
            this.rightHand.position.z = THREE.MathUtils.lerp(this.rightHand.position.z, 0, dt * 5);
            
            // Idle breathing bob
            this.time += dt;
            const breathe = Math.sin(this.time * 2) * 0.03;
            
            this.head.position.y = THREE.MathUtils.lerp(this.head.position.y, this.baseHeadY + breathe, dt * 5);
            this.torso.position.y = THREE.MathUtils.lerp(this.torso.position.y, this.baseTorsoY + breathe, dt * 5);
            this.leftHand.position.y = THREE.MathUtils.lerp(this.leftHand.position.y, this.baseHandY + breathe, dt * 5);
            this.rightHand.position.y = THREE.MathUtils.lerp(this.rightHand.position.y, this.baseHandY + breathe, dt * 5);
        }
    }
}
