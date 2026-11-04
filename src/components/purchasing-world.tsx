"use client";

import { useEffect, useRef, useState } from "react";

export type PurchasingWorldProps = {
  activeScene?: number;
  miniature?: boolean;
  paused?: boolean;
  onActivate?: () => void;
  onSelectNode?: (index: number) => void;
};

const PALETTES = [
  {
    ground: "#7646a3",
    mountain: "#4b236d",
    planet: "#c29be5",
    focus: "#c5ff91",
    skyTop: "#240b36",
    skyMiddle: "#873ec2",
    skyBottom: "#dbb9f2",
  },
  {
    ground: "#615395",
    mountain: "#392858",
    planet: "#b9b4ec",
    focus: "#e6c9ff",
    skyTop: "#201333",
    skyMiddle: "#7160bc",
    skyBottom: "#c7c2ef",
  },
  {
    ground: "#ac6e9b",
    mountain: "#673954",
    planet: "#f0c1dc",
    focus: "#ffe6aa",
    skyTop: "#38143e",
    skyMiddle: "#b770be",
    skyBottom: "#ffd2b7",
  },
];

/** RAF's shared timestamp can precede the performance.now() used to queue it. */
export function advanceWorldClock(
  elapsed: number,
  previousTime: number,
  now: number,
  paused = false,
) {
  const safeElapsed = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
  const safePrevious = Number.isFinite(previousTime) ? previousTime : 0;
  const timestamp = Number.isFinite(now) ? now : safePrevious;
  const delta =
    Number.isFinite(now) && Number.isFinite(previousTime)
      ? Math.max(0, Math.min((now - previousTime) / 1000, 0.05))
      : 0;
  return { elapsed: safeElapsed + (paused ? 0 : delta), timestamp };
}

/** CatmullRomCurve3.getPointAt requires a finite position in its unit interval. */
export function wrapWorldRoutePhase(phase: number) {
  return Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
}

/** A decorative, original low-poly world. The host supplies its accessible action. */
export function PurchasingWorld({
  activeScene = 0,
  miniature = false,
  paused = false,
  onActivate,
  onSelectNode,
}: PurchasingWorldProps) {
  const host = useRef<HTMLDivElement>(null);
  const selection = useRef(activeScene);
  const activate = useRef(onActivate);
  const selectNode = useRef(onSelectNode);
  const pause = useRef(paused);
  const requestRender = useRef<(() => void) | null>(null);
  const syncPlayback = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    selection.current =
      ((activeScene % PALETTES.length) + PALETTES.length) % PALETTES.length;
    requestRender.current?.();
  }, [activeScene]);
  useEffect(() => {
    activate.current = onActivate;
  }, [onActivate]);
  useEffect(() => {
    selectNode.current = onSelectNode;
  }, [onSelectNode]);
  useEffect(() => {
    pause.current = paused;
    syncPlayback.current?.();
  }, [paused]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let teardown = () => {};
    setReady(false);

    const initialize = async () => {
      const THREE = await import("three");
      if (disposed) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({
          alpha: false,
          antialias: true,
          powerPreference: "low-power",
        });
      } catch {
        return;
      }
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, miniature ? 1.5 : 1.75),
      );
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.18;
      renderer.domElement.setAttribute("aria-hidden", "true");
      Object.assign(renderer.domElement.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        display: "block",
        touchAction: "pan-y",
      });
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const disposeWorld = () => {
        const geometries = new Set<InstanceType<typeof THREE.BufferGeometry>>();
        const materials = new Set<InstanceType<typeof THREE.Material>>();
        scene.traverse((object) => {
          const drawable = object as InstanceType<typeof THREE.Mesh>;
          if (drawable.geometry) geometries.add(drawable.geometry);
          if (drawable.material)
            for (const material of Array.isArray(drawable.material)
              ? drawable.material
              : [drawable.material])
              materials.add(material);
        });
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
      // Keep initialization failures on the same fallback and disposal path.
      teardown = disposeWorld;
      scene.fog = new THREE.Fog("#9560bd", 27, 66);
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 150);
      const baseCamera = new THREE.Vector3(
        0,
        miniature ? 2.7 : 2.4,
        miniature ? 12.5 : 13.5,
      );
      camera.position.copy(baseCamera);
      const gaze = new THREE.Vector3(0, miniature ? 0.9 : 1.4, -15);
      camera.lookAt(gaze);

      const palette = PALETTES[selection.current] ?? PALETTES[0];
      const skyMaterial = new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          topColor: { value: new THREE.Color(palette.skyTop) },
          middleColor: { value: new THREE.Color(palette.skyMiddle) },
          bottomColor: { value: new THREE.Color(palette.skyBottom) },
          grainScale: { value: miniature ? 0.012 : 0.018 },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
        fragmentShader: `
          varying vec2 vUv;
          uniform vec3 topColor;
          uniform vec3 middleColor;
          uniform vec3 bottomColor;
          uniform float grainScale;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
          void main() {
            float y = vUv.y + sin(vUv.x * 5.3) * 0.035;
            vec3 color = mix(bottomColor, middleColor, smoothstep(0.12, 0.64, y));
            color = mix(color, topColor, smoothstep(0.54, 1.0, y));
            float halo = exp(-length((vUv - vec2(0.48, 0.42)) * vec2(1.2, 2.9)) * 3.2);
            color += vec3(0.075, 0.025, 0.11) * halo;
            color += (hash(gl_FragCoord.xy) - 0.5) * grainScale;
            gl_FragColor = vec4(color, 1.0);
            #include <colorspace_fragment>
          }`,
      });
      const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMaterial);
      sky.frustumCulled = false;
      sky.renderOrder = -1000;
      scene.add(sky);

      scene.add(new THREE.HemisphereLight("#f5d4ff", "#351846", 2.0));
      const key = new THREE.DirectionalLight("#f5dbff", 2.0);
      key.position.set(-9, 14, 8);
      scene.add(key);
      const rim = new THREE.DirectionalLight("#a765e5", 1.1);
      rim.position.set(12, 5, -14);
      scene.add(rim);

      let seed = 481516;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const groundMaterial = new THREE.MeshStandardMaterial({
        color: palette.ground,
        roughness: 1,
        metalness: 0,
        flatShading: true,
      });
      const mountainMaterial = new THREE.MeshStandardMaterial({
        color: palette.mountain,
        roughness: 1,
        flatShading: true,
      });
      const rockMaterial = new THREE.MeshStandardMaterial({
        color: "#613785",
        roughness: 1,
        flatShading: true,
      });
      const groundGeometry = new THREE.PlaneGeometry(130, 125, 20, 20);
      groundGeometry.rotateX(-Math.PI / 2);
      const groundVertices = groundGeometry.attributes.position;
      for (let i = 0; i < groundVertices.count; i++)
        groundVertices.setY(i, (random() - 0.5) * 0.18);
      groundGeometry.computeVertexNormals();
      const ground = new THREE.Mesh(groundGeometry, groundMaterial);
      ground.position.set(0, -2, -30);
      scene.add(ground);

      // Uneven faceted ridges create a continuous horizon rather than repeated cones.
      const ridgeGeometry = new THREE.BufferGeometry();
      const ridgePositions: number[] = [];
      const ridgeIndices: number[] = [];
      const sections = 30;
      for (let i = 0; i <= sections; i++) {
        const x = -70 + (i * 140) / sections;
        const height =
          2.2 + Math.pow(random(), 0.7) * 8 + Math.sin(i * 1.3) * 1.8;
        const z = -31 - random() * 7;
        ridgePositions.push(x, -2.1, z + 7, x, height, z, x, -2.1, z - 9);
        if (i < sections) {
          const k = i * 3;
          ridgeIndices.push(
            k,
            k + 3,
            k + 1,
            k + 1,
            k + 3,
            k + 4,
            k + 1,
            k + 4,
            k + 2,
            k + 2,
            k + 4,
            k + 5,
          );
        }
      }
      ridgeGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(ridgePositions, 3),
      );
      ridgeGeometry.setIndex(ridgeIndices);
      ridgeGeometry.computeVertexNormals();
      scene.add(new THREE.Mesh(ridgeGeometry, mountainMaterial));

      const nodeLocations = [
        { x: -3.8, z: -9, scale: 0.9, turn: 0.24 },
        { x: 4.7, z: -27, scale: 0.76, turn: -0.28 },
        { x: 3.1, z: -4, scale: 0.55, turn: -0.18 },
      ];
      const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
      for (let i = 0; i < 35; i++) {
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        let x = (random() - 0.5) * 66;
        const z = -30 + random() * 36;
        if (Math.abs(x) < 3.5 && z > -5) x += x < 0 ? -5 : 5;
        if (
          nodeLocations.some(
            (node) =>
              Math.abs(x - node.x) < node.scale * 3.5 + 1 &&
              Math.abs(z - node.z) < node.scale * 3.5 + 1,
          )
        )
          x += x < 0 ? -6 : 6;
        const scale = 0.18 + random() * 0.8;
        rock.scale.set(
          scale * (1.1 + random()),
          scale * (0.5 + random() * 0.4),
          scale,
        );
        rock.position.set(x, -2 + rock.scale.y * 0.35, z);
        rock.rotation.set(random() * 0.8, random() * Math.PI, random() * 0.6);
        scene.add(rock);
      }
      const foreground = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 0),
        rockMaterial,
      );
      foreground.scale.set(5.8, 4.2, 6);
      foreground.position.set(10.5, -1.5, 1.5);
      foreground.rotation.set(0.2, 0.5, -0.2);
      scene.add(foreground);

      // Fulfillment nodes share an architectural language: ribbed hangars and loading bays.
      const planetMaterial = new THREE.MeshStandardMaterial({
        color: palette.planet,
        roughness: 0.75,
        metalness: 0.12,
      });
      const ribMaterial = new THREE.MeshStandardMaterial({
        color: "#eee1fa",
        roughness: 0.6,
        metalness: 0.15,
      });
      const dockMaterial = new THREE.MeshStandardMaterial({
        color: "#49295f",
        roughness: 0.8,
      });
      const doorMaterial = new THREE.MeshStandardMaterial({
        color: "#725183",
        roughness: 0.7,
        metalness: 0.2,
      });
      const lampMaterial = new THREE.MeshBasicMaterial({ color: "#e1ffd1" });
      const crateMaterial = new THREE.MeshStandardMaterial({
        color: "#d7bbe8",
        roughness: 0.9,
      });
      const unitBox = new THREE.BoxGeometry(1, 1, 1);
      const shellShape = new THREE.Shape();
      shellShape.moveTo(-2.5, 0);
      shellShape.lineTo(2.5, 0);
      shellShape.lineTo(2.5, 1.35);
      shellShape.absarc(0, 1.35, 2.5, 0, Math.PI, false);
      shellShape.lineTo(-2.5, 0);
      const warehouseGeometry = new THREE.ExtrudeGeometry(shellShape, {
        depth: 4.1,
        bevelEnabled: true,
        bevelSize: 0.035,
        bevelThickness: 0.035,
        bevelSegments: 1,
        curveSegments: 16,
      });
      warehouseGeometry.translate(0, 0, -2.05);
      const roofRibGeometry = new THREE.TorusGeometry(
        2.53,
        0.035,
        4,
        28,
        Math.PI,
      );
      const box = (
        parent: InstanceType<typeof THREE.Group>,
        material: InstanceType<typeof THREE.Material>,
        size: [number, number, number],
        position: [number, number, number],
      ) => {
        const mesh = new THREE.Mesh(unitBox, material);
        mesh.scale.set(...size);
        mesh.position.set(...position);
        parent.add(mesh);
        return mesh;
      };
      const warehouses: InstanceType<typeof THREE.Group>[] = [];
      nodeLocations.forEach(({ x, z, scale, turn }, index) => {
        const warehouse = new THREE.Group();
        warehouse.position.set(x, -1.88, z);
        warehouse.rotation.y = turn;
        warehouse.scale.setScalar(scale);
        warehouse.add(new THREE.Mesh(warehouseGeometry, planetMaterial));
        box(warehouse, dockMaterial, [6.1, 0.2, 6.1], [0, -0.04, 0.5]);
        for (let ribIndex = 0; ribIndex < 7; ribIndex++) {
          const depth = -2.05 + (ribIndex * 4.1) / 6;
          const rib = new THREE.Mesh(roofRibGeometry, ribMaterial);
          rib.position.set(0, 1.35, depth);
          warehouse.add(rib);
          box(
            warehouse,
            ribMaterial,
            [0.045, 1.35, 0.045],
            [-2.53, 0.675, depth],
          );
          box(
            warehouse,
            ribMaterial,
            [0.045, 1.35, 0.045],
            [2.53, 0.675, depth],
          );
        }
        for (const bayX of [-1.17, 1.17]) {
          box(warehouse, ribMaterial, [1.91, 1.97, 0.12], [bayX, 1.02, 2.1]);
          box(warehouse, dockMaterial, [1.71, 1.79, 0.13], [bayX, 0.96, 2.18]);
          for (let slat = 0; slat < 6; slat++)
            box(
              warehouse,
              doorMaterial,
              [1.62, 0.19, 0.04],
              [bayX, 0.3 + slat * 0.25, 2.27],
            );
          box(warehouse, lampMaterial, [1.6, 0.065, 0.09], [bayX, 2.05, 2.21]);
          for (const offset of [-0.65, 0.65])
            box(
              warehouse,
              ribMaterial,
              [0.04, 0.012, 0.8],
              [bayX + offset, 0.07, 2.92],
            );
        }
        for (const [crateX, crateY, crateZ] of [
          [-2.62, 0.3, 2.7],
          [-2.62, 0.87, 2.7],
          [-2.04, 0.3, 3.07],
        ]) {
          box(
            warehouse,
            crateMaterial,
            [0.51, 0.54, 0.51],
            [crateX, crateY, crateZ],
          );
          box(
            warehouse,
            dockMaterial,
            [0.09, 0.548, 0.518],
            [crateX, crateY, crateZ],
          );
        }
        warehouse.traverse((object) => {
          object.userData.nodeIndex = index;
        });
        warehouses.push(warehouse);
        scene.add(warehouse);
      });

      // These ambient paths describe a network, not shipment progress or live status.
      const routeMaterial = new THREE.MeshBasicMaterial({
        color: "#d7c2f2",
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      });
      const routeGlowMaterial = new THREE.MeshBasicMaterial({
        color: "#e3c5ff",
        transparent: true,
        opacity: 0.045,
        depthWrite: false,
      });
      const flowGeometry = new THREE.SphereGeometry(0.055, 8, 6);
      const routes: {
        curve: InstanceType<typeof THREE.CatmullRomCurve3>;
        light: InstanceType<typeof THREE.Mesh>;
      }[] = [];
      for (const [from, to, rise] of [
        [0, 1, 0.5],
        [1, 2, 0.1],
        [2, 0, 0.7],
      ]) {
        const start = new THREE.Vector3(
          nodeLocations[from].x,
          -1.48,
          nodeLocations[from].z + nodeLocations[from].scale * 3.2,
        );
        const end = new THREE.Vector3(
          nodeLocations[to].x,
          -1.48,
          nodeLocations[to].z + nodeLocations[to].scale * 3.2,
        );
        const midpoint = start.clone().lerp(end, 0.5);
        midpoint.y = rise;
        midpoint.z -= 1.7;
        const curve = new THREE.CatmullRomCurve3([start, midpoint, end]);
        scene.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(curve, 42, 0.018, 4, false),
            routeMaterial,
          ),
        );
        scene.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(curve, 42, 0.09, 5, false),
            routeGlowMaterial,
          ),
        );
        const light = new THREE.Mesh(flowGeometry, lampMaterial);
        curve.getPointAt(0.25, light.position);
        scene.add(light);
        routes.push({ curve, light });
      }

      const focal = new THREE.Group();
      focal.position.set(0, miniature ? 0.1 : 0.35, miniature ? 2 : 2.8);
      const focusMaterial = new THREE.MeshStandardMaterial({
        color: miniature ? "#efc9ff" : palette.focus,
        emissive: miniature ? "#b571de" : palette.focus,
        emissiveIntensity: 0.13,
        roughness: 0.78,
        metalness: 0,
        flatShading: true,
      });
      const focusOutlineMaterial = new THREE.LineBasicMaterial({
        color: miniature ? "#b979d4" : "#668942",
        transparent: true,
        opacity: 0.72,
      });
      const focalGeometry = new THREE.BoxGeometry(1.18, 1, 1.1);
      const focalMesh = new THREE.Mesh(focalGeometry, focusMaterial);
      focal.add(
        focalMesh,
        new THREE.LineSegments(
          new THREE.EdgesGeometry(focalGeometry),
          focusOutlineMaterial,
        ),
      );
      const tapeMaterial = new THREE.MeshStandardMaterial({
        color: "#593565",
        roughness: 0.85,
      });
      const labelMaterial = new THREE.MeshStandardMaterial({
        color: "#fffbef",
        roughness: 1,
      });
      box(focal, tapeMaterial, [0.19, 1.012, 1.112], [-0.11, 0, 0]);
      box(focal, tapeMaterial, [1.188, 0.012, 0.13], [0, 0.506, 0]);
      box(focal, labelMaterial, [0.29, 0.25, 0.007], [0.3, 0.1, 0.555]);
      for (let line = 0; line < 3; line++)
        box(
          focal,
          tapeMaterial,
          [line === 0 ? 0.18 : 0.13, 0.013, 0.004],
          [0.29, 0.175 - line * 0.037, 0.561],
        );
      for (let bar = 0; bar < 7; bar++)
        box(
          focal,
          tapeMaterial,
          [bar % 3 === 0 ? 0.018 : 0.009, 0.044, 0.004],
          [0.21 + bar * 0.027, 0.032, 0.561],
        );
      if (miniature) focal.scale.setScalar(1.35);
      focal.rotation.y = -0.55;
      scene.add(focal);
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(miniature ? 0.7 : 0.92, 32),
        new THREE.MeshBasicMaterial({
          color: "#361847",
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, -1.89, focal.position.z);
      shadow.scale.y = 0.65;
      scene.add(shadow);

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const mouse = new THREE.Vector2();
      const targetCamera = new THREE.Vector3();
      const paletteColors = PALETTES.map((p) =>
        Object.fromEntries(
          Object.entries(p).map(([name, value]) => [
            name,
            new THREE.Color(value),
          ]),
        ),
      );
      let width = 1;
      let height = 1;
      let frame = 0;
      let elapsed = 0;
      let previousTime = performance.now();
      let running = false;
      let intersecting = true;
      let press: { x: number; y: number } | null = null;
      let lost = false;
      const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      let reducedMotion = motionQuery.matches;
      const baseFocalY = focal.position.y;

      const render = (now: number) => {
        if (disposed || lost || document.hidden || !intersecting) {
          running = false;
          return;
        }
        const frozen = pause.current;
        const clock = advanceWorldClock(
          elapsed,
          previousTime,
          now,
          frozen || reducedMotion,
        );
        elapsed = clock.elapsed;
        previousTime = clock.timestamp;
        const current = paletteColors[selection.current] ?? paletteColors[0];
        const colorMix = reducedMotion || frozen ? 1 : 0.035;
        groundMaterial.color.lerp(current.ground, colorMix);
        mountainMaterial.color.lerp(current.mountain, colorMix);
        planetMaterial.color.lerp(current.planet, colorMix);
        if (!miniature) {
          focusMaterial.color.lerp(current.focus, colorMix);
          focusMaterial.emissive.lerp(current.focus, colorMix);
        }
        skyMaterial.uniforms.topColor.value.lerp(current.skyTop, colorMix);
        skyMaterial.uniforms.middleColor.value.lerp(
          current.skyMiddle,
          colorMix,
        );
        skyMaterial.uniforms.bottomColor.value.lerp(
          current.skyBottom,
          colorMix,
        );
        if (!frozen) {
          targetCamera.copy(baseCamera);
          if (!reducedMotion && !miniature) {
            targetCamera.x += mouse.x * 0.42;
            targetCamera.y += mouse.y * 0.16;
          }
          camera.position.lerp(targetCamera, reducedMotion ? 1 : 0.045);
          camera.lookAt(gaze);
          focal.position.y =
            baseFocalY + (reducedMotion ? 0 : Math.sin(elapsed * 0.95) * 0.12);
          const rotation =
            -0.55 +
            selection.current * 0.3 +
            (reducedMotion ? 0 : Math.sin(elapsed * 0.28) * 0.06);
          focal.rotation.y +=
            (rotation - focal.rotation.y) * (reducedMotion ? 1 : 0.04);
          for (let i = 0; i < routes.length; i++) {
            const route = routes[i];
            route.curve.getPointAt(
              reducedMotion
                ? 0.25
                : wrapWorldRoutePhase(elapsed * 0.035 + i / 3),
              route.light.position,
            );
          }
        }
        renderer.render(scene, camera);
        if (reducedMotion || frozen) {
          running = false;
        } else {
          frame = requestAnimationFrame(render);
        }
      };
      const invalidate = () => {
        if (
          !running &&
          !disposed &&
          !lost &&
          !document.hidden &&
          intersecting
        ) {
          running = true;
          previousTime = performance.now();
          frame = requestAnimationFrame(render);
        }
      };
      requestRender.current = invalidate;
      syncPlayback.current = () => {
        cancelAnimationFrame(frame);
        running = false;
        press = null;
        renderer.domElement.style.cursor = "auto";
        if (!pause.current) invalidate();
      };
      const resize = () => {
        if (disposed || lost) return;
        width = Math.max(1, container.clientWidth);
        height = Math.max(1, container.clientHeight);
        camera.aspect = width / height;
        const portraitAmount = miniature
          ? 0
          : THREE.MathUtils.clamp((0.8 - camera.aspect) / 0.22, 0, 1);
        camera.fov = miniature ? 38 : 42 + portraitAmount * 7;
        if (!miniature) {
          // Portrait leaves the lower screen for the location card. Pull back
          // and look down so the complete network occupies the clear map area.
          baseCamera.set(
            0,
            THREE.MathUtils.lerp(2.4, 4.4, portraitAmount),
            THREE.MathUtils.lerp(13.5, 26, portraitAmount),
          );
          gaze.set(0, THREE.MathUtils.lerp(1.4, -1.8, portraitAmount), -15);
          camera.position.copy(baseCamera);
          camera.lookAt(gaze);
          mouse.set(0, 0);
        }
        camera.updateProjectionMatrix();
        const pixelRatio = Math.min(
          window.devicePixelRatio || 1,
          miniature ? 1.5 : 1.75,
        );
        if (renderer.getPixelRatio() !== pixelRatio)
          renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height, false);
        warehouses.forEach((warehouse) => {
          warehouse.visible = !miniature || width > 200;
        });
        // setSize clears the drawing buffer. Draw before a pause or observer
        // update can cancel the scheduled animation frame and leave it blank.
        renderer.render(scene, camera);
        invalidate();
      };
      const pointAt = (event: PointerEvent) => {
        const bounds = renderer.domElement.getBoundingClientRect();
        pointer.set(
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster
          .intersectObjects([focal, ...warehouses], true)
          .find((entry) => entry.object.type === "Mesh");
        if (!hit) return null;
        const nodeIndex = hit.object.userData.nodeIndex;
        return typeof nodeIndex === "number"
          ? { kind: "node" as const, index: nodeIndex }
          : { kind: "parcel" as const };
      };
      const onPointerMove = (event: PointerEvent) => {
        if (miniature || pause.current) return;
        const hit = pointAt(event);
        if (!reducedMotion) mouse.copy(pointer);
        renderer.domElement.style.cursor =
          hit && (hit.kind === "node" ? selectNode.current : activate.current)
            ? "pointer"
            : "auto";
      };
      const onPointerLeave = () => {
        mouse.set(0, 0);
        press = null;
        renderer.domElement.style.cursor = "auto";
      };
      const onPointerDown = (event: PointerEvent) => {
        if (pause.current) return;
        press = { x: event.clientX, y: event.clientY };
      };
      const onPointerUp = (event: PointerEvent) => {
        if (miniature || pause.current || !press) return;
        const moved = Math.hypot(
          event.clientX - press.x,
          event.clientY - press.y,
        );
        press = null;
        if (moved >= 7) return;
        const hit = pointAt(event);
        if (hit?.kind === "node") selectNode.current?.(hit.index);
        else if (hit?.kind === "parcel") activate.current?.();
      };
      const onVisibility = () => {
        if (document.hidden) {
          cancelAnimationFrame(frame);
          running = false;
        } else invalidate();
      };
      const onMotion = () => {
        reducedMotion = motionQuery.matches;
        mouse.set(0, 0);
        invalidate();
      };
      const onContextLost = (event: Event) => {
        event.preventDefault();
        lost = true;
        cancelAnimationFrame(frame);
        running = false;
        renderer.domElement.style.display = "none";
        setReady(false);
      };
      const onContextRestored = () => {
        if (disposed) return;
        lost = false;
        renderer.domElement.style.display = "block";
        resize();
        setReady(true);
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      const intersectionObserver = new IntersectionObserver(([entry]) => {
        intersecting = entry.isIntersecting;
        if (intersecting) invalidate();
        else {
          cancelAnimationFrame(frame);
          running = false;
        }
      });
      intersectionObserver.observe(container);
      renderer.domElement.addEventListener("pointermove", onPointerMove);
      renderer.domElement.addEventListener("pointerleave", onPointerLeave);
      renderer.domElement.addEventListener("pointerdown", onPointerDown);
      renderer.domElement.addEventListener("pointerup", onPointerUp);
      renderer.domElement.addEventListener("webglcontextlost", onContextLost);
      renderer.domElement.addEventListener(
        "webglcontextrestored",
        onContextRestored,
      );
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("resize", resize);
      motionQuery.addEventListener("change", onMotion);
      resize();
      renderer.render(scene, camera);
      setReady(true);
      invalidate();

      teardown = () => {
        cancelAnimationFrame(frame);
        requestRender.current = null;
        syncPlayback.current = null;
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("resize", resize);
        motionQuery.removeEventListener("change", onMotion);
        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        renderer.domElement.removeEventListener("pointerup", onPointerUp);
        renderer.domElement.removeEventListener(
          "webglcontextlost",
          onContextLost,
        );
        renderer.domElement.removeEventListener(
          "webglcontextrestored",
          onContextRestored,
        );
        disposeWorld();
      };
    };

    void initialize().catch(() => {
      if (!disposed) setReady(false);
      teardown();
    });
    return () => {
      disposed = true;
      teardown();
    };
  }, [miniature]);

  return (
    <div
      ref={host}
      className="purchasing-world"
      aria-hidden="true"
      data-ready={ready}
      data-miniature={miniature}
      data-paused={paused}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        isolation: "isolate",
      }}
    >
      <div
        className="purchasing-world-fallback"
        style={{
          position: "absolute",
          inset: 0,
          opacity: ready ? 0 : 1,
          pointerEvents: "none",
          background:
            "linear-gradient(180deg,#240b36 0%,#6e2d9b 39%,#c990ef 68%,#b785ce 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "43% -5% 0",
            background: "#573076",
            clipPath:
              "polygon(0 30%,9% 12%,18% 27%,29% 0,43% 19%,53% 34%,65% 22%,77% 8%,86% 20%,100% 3%,100% 100%,0 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: "59% 0 0",
            background: "linear-gradient(#925db7,#6d3c99)",
          }}
        />
        <svg
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
          }}
        >
          <path
            d="M360 670 Q470 430 590 570 Q670 565 640 750 Q485 560 360 670"
            fill="none"
            stroke="#e8ceff"
            strokeWidth="2"
            opacity="0.6"
          />
        </svg>
        {[
          {
            left: "36%",
            top: "57%",
            width: miniature ? 47 : 145,
            height: miniature ? 34 : 105,
          },
          {
            left: "59%",
            top: "51%",
            width: miniature ? 25 : 76,
            height: miniature ? 20 : 60,
          },
          {
            left: "64%",
            top: "66%",
            width: miniature ? 31 : 94,
            height: miniature ? 23 : 70,
          },
        ].map((node, index) => (
          <div
            key={index}
            style={{
              position: "absolute",
              ...node,
              transform: "translate(-50%, -50%)",
              borderRadius: "48% 48% 3px 3px",
              background:
                "repeating-linear-gradient(95deg,transparent 0 13%,#f1e1fa66 13% 14%),linear-gradient(115deg,#eed9fc,#ad84c5)",
              boxShadow: "8px 8px 0 #76518e, 0 13px 18px #35144835",
            }}
          >
            {["17%", "55%"].map((left) => (
              <span
                key={left}
                style={{
                  position: "absolute",
                  left,
                  bottom: 0,
                  width: "28%",
                  height: "48%",
                  background:
                    "repeating-linear-gradient(0deg,#57376c 0 13%,#826296 13% 16%)",
                  borderTop: "2px solid #e3ffcf",
                }}
              />
            ))}
          </div>
        ))}
        <div
          style={{
            position: "absolute",
            width: miniature ? 39 : 64,
            height: miniature ? 34 : 56,
            top: "72%",
            left: "50%",
            background: miniature
              ? "linear-gradient(110deg,#f5ddff,#cb88ed 64%,#8e4fc5)"
              : "linear-gradient(110deg,#dcffb6,#c2ff8c 64%,#a3d96f)",
            border: "1px solid #6d874366",
            transform: "translate(-50%,-50%) rotate(-7deg)",
            clipPath: "polygon(0 12%,48% 0,100% 12%,100% 88%,51% 100%,0 88%)",
            boxShadow: "0 15px 35px #421b5c33",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: "34%",
              top: 0,
              width: "15%",
              height: "100%",
              background: "#593565",
            }}
          />
          <span
            style={{
              position: "absolute",
              right: "12%",
              top: "31%",
              width: "26%",
              height: "26%",
              background: "#fffbef",
              borderBottom: "3px double #593565",
            }}
          />
        </div>
      </div>
    </div>
  );
}
