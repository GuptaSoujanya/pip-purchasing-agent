"use client";

import { useEffect, useRef, useState } from "react";

export type PurchasingWorldProps = {
  activeScene?: number;
  miniature?: boolean;
  paused?: boolean;
  onActivate?: () => void;
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

/** A decorative, original low-poly world. The host supplies its accessible action. */
export function PurchasingWorld({
  activeScene = 0,
  miniature = false,
  paused = false,
  onActivate,
}: PurchasingWorldProps) {
  const host = useRef<HTMLDivElement>(null);
  const selection = useRef(activeScene);
  const activate = useRef(onActivate);
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

      const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
      for (let i = 0; i < 35; i++) {
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        let x = (random() - 0.5) * 66;
        const z = -30 + random() * 36;
        if (Math.abs(x) < 3.5 && z > -5) x += x < 0 ? -5 : 5;
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

      // An orbital observatory, intentionally original rather than the reference's branding.
      const observatory = new THREE.Group();
      observatory.position.set(-8.7, 1.05, -12);
      observatory.rotation.z = -0.1;
      observatory.rotation.y = -0.15;
      const planetMaterial = new THREE.MeshStandardMaterial({
        color: palette.planet,
        roughness: 0.9,
        metalness: 0.03,
      });
      const planet = new THREE.Mesh(
        new THREE.SphereGeometry(2.75, 48, 32),
        planetMaterial,
      );
      observatory.add(planet);
      const bandMaterial = new THREE.MeshStandardMaterial({
        color: "#62347d",
        roughness: 1,
      });
      for (const elevation of [-1.8, -1.55, 1.65, 2.1]) {
        const radius = Math.sqrt(2.75 ** 2 - elevation ** 2) + 0.012;
        const band = new THREE.Mesh(
          new THREE.TorusGeometry(radius, 0.012, 4, 64),
          bandMaterial,
        );
        band.rotation.x = Math.PI / 2;
        band.position.y = elevation;
        observatory.add(band);
      }
      const visorMaterial = new THREE.MeshStandardMaterial({
        color: "#472164",
        roughness: 0.28,
        metalness: 0.25,
      });
      const frameMaterial = new THREE.MeshStandardMaterial({
        color: "#d7b4f1",
        roughness: 0.75,
      });
      for (const phi of [0.68, 1.69]) {
        const frame = new THREE.Mesh(
          new THREE.SphereGeometry(2.78, 20, 16, phi, 0.88, 1.03, 0.68),
          frameMaterial,
        );
        const visor = new THREE.Mesh(
          new THREE.SphereGeometry(2.8, 20, 16, phi + 0.035, 0.81, 1.065, 0.61),
          visorMaterial,
        );
        observatory.add(frame, visor);
      }
      const platform = new THREE.Mesh(
        new THREE.DodecahedronGeometry(3.2, 0),
        rockMaterial,
      );
      platform.position.set(-0.3, -3.4, 0.2);
      platform.scale.set(1.1, 0.19, 0.78);
      observatory.add(platform);
      const lowerLight = new THREE.Mesh(
        new THREE.CircleGeometry(0.68, 32),
        new THREE.MeshBasicMaterial({
          color: "#8fa3ff",
          transparent: true,
          opacity: 0.85,
        }),
      );
      lowerLight.rotation.x = -Math.PI / 2;
      lowerLight.position.set(0, -2.92, 0);
      observatory.add(lowerLight);
      scene.add(observatory);

      const floatingRocks: InstanceType<typeof THREE.Mesh>[] = [];
      for (const [x, y, z, scale] of [
        [-6, 5.4, -23, 0.65],
        [7.2, 3.1, -19, 0.35],
        [-3.5, 3.7, -29, 0.3],
      ]) {
        const stone = new THREE.Mesh(rockGeometry, mountainMaterial);
        stone.position.set(x, y, z);
        stone.scale.set(scale, scale * 0.6, scale * 0.8);
        stone.rotation.set(0.5, 0.4, -0.3);
        stone.userData.baseY = y;
        floatingRocks.push(stone);
        scene.add(stone);
      }

      const focal = new THREE.Group();
      focal.position.set(0, miniature ? 0.1 : -0.15, miniature ? 2 : 2.8);
      const focusMaterial = new THREE.MeshStandardMaterial({
        color: miniature ? "#efc9ff" : palette.focus,
        emissive: miniature ? "#b571de" : palette.focus,
        emissiveIntensity: 0.13,
        roughness: 0.38,
        metalness: 0.06,
        flatShading: true,
        transparent: true,
        opacity: 0.94,
      });
      const focusOutlineMaterial = new THREE.LineBasicMaterial({
        color: miniature ? "#b979d4" : "#668942",
        transparent: true,
        opacity: 0.72,
      });
      const focalGeometry = miniature
        ? new THREE.CylinderGeometry(0.32, 0.4, 1.85, 6)
        : new THREE.BoxGeometry(1.04, 1.04, 1.04);
      const focalMesh = new THREE.Mesh(focalGeometry, focusMaterial);
      focal.add(
        focalMesh,
        new THREE.LineSegments(
          new THREE.EdgesGeometry(focalGeometry),
          focusOutlineMaterial,
        ),
      );
      if (miniature) {
        const crown = new THREE.Mesh(
          new THREE.ConeGeometry(0.32, 0.55, 6),
          focusMaterial,
        );
        crown.position.y = 1.2;
        focal.add(crown);
        focal.rotation.z = 0.08;
      }
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
        if (!frozen) elapsed += Math.min((now - previousTime) / 1000, 0.05);
        previousTime = now;
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
          for (let i = 0; i < floatingRocks.length; i++) {
            const stone = floatingRocks[i];
            stone.position.y =
              stone.userData.baseY +
              (reducedMotion ? 0 : Math.sin(elapsed * 0.45 + i) * 0.08);
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
        width = Math.max(1, container.clientWidth);
        height = Math.max(1, container.clientHeight);
        camera.aspect = width / height;
        camera.fov = miniature ? 38 : width / height < 0.8 ? 49 : 42;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        observatory.visible = !miniature || width > 200;
        invalidate();
      };
      const pointAt = (event: PointerEvent) => {
        const bounds = renderer.domElement.getBoundingClientRect();
        pointer.set(
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointer, camera);
        return raycaster
          .intersectObjects(focal.children, false)
          .some((hit) => hit.object.type === "Mesh");
      };
      const onPointerMove = (event: PointerEvent) => {
        if (miniature || pause.current) return;
        const hit = pointAt(event);
        if (!reducedMotion) mouse.copy(pointer);
        renderer.domElement.style.cursor =
          hit && activate.current ? "pointer" : "auto";
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
        if (moved < 7 && pointAt(event)) activate.current?.();
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
      document.addEventListener("visibilitychange", onVisibility);
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
        motionQuery.removeEventListener("change", onMotion);
        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        renderer.domElement.removeEventListener("pointerup", onPointerUp);
        renderer.domElement.removeEventListener(
          "webglcontextlost",
          onContextLost,
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
        <div
          style={{
            position: "absolute",
            width: miniature ? 35 : 64,
            height: miniature ? 64 : 64,
            top: "67%",
            left: "50%",
            background: miniature
              ? "linear-gradient(110deg,#f5ddff,#cb88ed 64%,#8e4fc5)"
              : "linear-gradient(110deg,#dcffb6,#c2ff8c 64%,#a3d96f)",
            border: "1px solid #6d874366",
            transform: "translate(-50%,-50%) rotate(-7deg)",
            clipPath: miniature
              ? "polygon(50% 0,100% 18%,87% 100%,18% 91%,0 22%)"
              : "polygon(0 12%,48% 0,100% 12%,100% 88%,51% 100%,0 88%)",
            boxShadow: "0 15px 35px #421b5c33",
          }}
        />
      </div>
    </div>
  );
}
