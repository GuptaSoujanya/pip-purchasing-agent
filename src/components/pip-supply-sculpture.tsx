"use client";

import { useEffect, useRef, useState } from "react";
import type * as Three from "three";
import "./pip-supply-sculpture.css";

export type PipSupplyNode = {
  id: string;
  city: string;
  alerts: number;
  usedCapacity: number;
};

export type PipSupplySculptureProps = {
  nodes: PipSupplyNode[];
  selectedNode: number;
  onSelectNode: (index: number) => void;
  paused?: boolean;
};

const COLORS = {
  paper: "#f4f1e9",
  ink: "#20231f",
  cobalt: "#2449ef",
  orange: "#f6623e",
  lime: "#d9ed82",
  white: "#fffdf8",
};

/** An original, decorative model of the locations selected by the controls below. */
export function PipSupplySculpture({
  nodes,
  selectedNode,
  onSelectNode,
  paused = false,
}: PipSupplySculptureProps) {
  const host = useRef<HTMLDivElement>(null);
  const selected = useRef(selectedNode);
  const select = useRef(onSelectNode);
  const pause = useRef(paused);
  const update = useRef<(() => void) | null>(null);
  const playback = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const nodeCount = Math.min(nodes.length, 3);

  useEffect(() => {
    selected.current = selectedNode;
    update.current?.();
  }, [selectedNode]);
  useEffect(() => {
    select.current = onSelectNode;
  }, [onSelectNode]);
  useEffect(() => {
    pause.current = paused || userPaused;
    playback.current?.();
  }, [paused, userPaused]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let destroy = () => {};
    setReady(false);

    const initialize = async () => {
      const THREE = await import("three");
      if (disposed) return;

      let renderer: Three.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "low-power",
        });
      } catch {
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.setAttribute("aria-hidden", "true");
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const world = new THREE.Group();
      scene.add(world);
      const camera = new THREE.OrthographicCamera(-5, 5, 3.6, -3.6, 0.1, 60);
      const cameraOrigin = new THREE.Vector3(7.4, 6.4, 12.8);
      camera.position.copy(cameraOrigin);
      const cameraTarget = new THREE.Vector3(0, 0.45, 0);
      camera.lookAt(cameraTarget);
      const geometries = new Set<Three.BufferGeometry>();
      const materials = new Set<Three.Material>();
      const textures = new Set<Three.Texture>();
      let shadowLight: Three.DirectionalLight | null = null;
      const disposeResources = () => {
        for (const geometry of geometries) geometry.dispose();
        for (const finish of materials) finish.dispose();
        for (const texture of textures) texture.dispose();
        shadowLight?.shadow.map?.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
      destroy = disposeResources;
      const material = (color: string, roughness = 0.6) => {
        const result = new THREE.MeshStandardMaterial({ color, roughness });
        materials.add(result);
        return result;
      };
      const orange = material(COLORS.orange, 0.45);
      const cobalt = material(COLORS.cobalt, 0.38);
      const white = material(COLORS.white, 0.68);
      const ink = material(COLORS.ink, 0.52);
      const lime = material(COLORS.lime, 0.55);
      const paleBlue = material("#b9c9fb", 0.65);

      const mesh = <G extends Three.BufferGeometry>(
        geometry: G,
        finish: Three.Material,
        parent: Three.Object3D = world,
      ) => {
        geometries.add(geometry);
        const result = new THREE.Mesh(geometry, finish);
        result.castShadow = true;
        result.receiveShadow = true;
        parent.add(result);
        return result;
      };
      const box = (
        width: number,
        height: number,
        depth: number,
        finish: Three.Material,
        parent: Three.Object3D = world,
      ) => mesh(new THREE.BoxGeometry(width, height, depth), finish, parent);
      const roundedGeometry = (
        width: number,
        height: number,
        depth: number,
        radius: number,
        bevel = 0.04,
      ) => {
        const shape = new THREE.Shape();
        const x = -width / 2;
        const y = -height / 2;
        shape.moveTo(x + radius, y);
        shape.lineTo(x + width - radius, y);
        shape.quadraticCurveTo(x + width, y, x + width, y + radius);
        shape.lineTo(x + width, y + height - radius);
        shape.quadraticCurveTo(
          x + width,
          y + height,
          x + width - radius,
          y + height,
        );
        shape.lineTo(x + radius, y + height);
        shape.quadraticCurveTo(x, y + height, x, y + height - radius);
        shape.lineTo(x, y + radius);
        shape.quadraticCurveTo(x, y, x + radius, y);
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth,
          bevelEnabled: true,
          bevelSegments: 3,
          steps: 1,
          bevelSize: bevel,
          bevelThickness: bevel,
          curveSegments: 7,
        });
        geometry.translate(0, 0, -depth / 2);
        return geometry;
      };

      scene.add(new THREE.HemisphereLight(0xffffff, 0xb4a99a, 2.6));
      const key = new THREE.DirectionalLight(0xfff9ec, 4);
      shadowLight = key;
      key.position.set(-4, 10, 7);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -6;
      key.shadow.camera.right = 6;
      key.shadow.camera.top = 6;
      key.shadow.camera.bottom = -6;
      key.shadow.normalBias = 0.035;
      key.shadow.bias = -0.0002;
      key.shadow.radius = 3;
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xe0e7ff, 1.4);
      fill.position.set(6, 4, -4);
      scene.add(fill);
      const shadowMaterial = new THREE.ShadowMaterial({ opacity: 0.1 });
      materials.add(shadowMaterial);
      const ground = mesh(
        new THREE.PlaneGeometry(35, 35),
        shadowMaterial,
        scene,
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -1.14;
      ground.castShadow = false;

      // A broad, feathered contact shadow grounds the sculpture without a backdrop.
      const shadowCanvas = document.createElement("canvas");
      shadowCanvas.width = 128;
      shadowCanvas.height = 128;
      const shadowContext = shadowCanvas.getContext("2d");
      if (shadowContext) {
        const gradient = shadowContext.createRadialGradient(
          64,
          64,
          4,
          64,
          64,
          64,
        );
        gradient.addColorStop(0, "rgba(32,35,31,.23)");
        gradient.addColorStop(0.5, "rgba(32,35,31,.09)");
        gradient.addColorStop(1, "rgba(32,35,31,0)");
        shadowContext.fillStyle = gradient;
        shadowContext.fillRect(0, 0, 128, 128);
        const texture = new THREE.CanvasTexture(shadowCanvas);
        textures.add(texture);
        const finish = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
        });
        materials.add(finish);
        const contact = mesh(new THREE.PlaneGeometry(6.4, 5.1), finish);
        contact.position.set(0, -1.125, 0.3);
        contact.rotation.x = -Math.PI / 2;
        contact.castShadow = false;
        contact.receiveShadow = false;
      }

      const pip = new THREE.Group();
      pip.position.set(-0.2, 1.03, -0.05);
      pip.rotation.y = 0.08;
      pip.rotation.z = -0.065;
      world.add(pip);
      mesh(roundedGeometry(2.6, 2.6, 1.75, 0.4, 0.13), orange, pip);

      // Packing tape and a shipping label make Pip a parcel, even before the face.
      box(0.36, 0.045, 1.72, cobalt, pip).position.set(0, 1.435, 0);
      box(0.36, 0.28, 0.035, cobalt, pip).position.set(0, 1.18, 1.015);
      box(0.36, 0.22, 0.035, cobalt, pip).position.set(0, -1.2, 1.015);
      const face = mesh(
        roundedGeometry(1.99, 1.64, 0.035, 0.3, 0.025),
        white,
        pip,
      );
      face.position.set(0, 0.19, 1.015);
      for (const side of [-1, 1]) {
        const arm = mesh(
          new THREE.CapsuleGeometry(0.16, 0.42, 5, 14),
          orange,
          pip,
        );
        arm.position.set(side * 1.53, -0.19, 0.18);
        arm.rotation.z = side * 0.48;
      }
      const shippingLabel = mesh(
        roundedGeometry(0.6, 0.37, 0.018, 0.035, 0.008),
        white,
        pip,
      );
      shippingLabel.position.set(0.7, -0.86, 1.018);
      shippingLabel.rotation.z = -0.06;
      for (let i = 0; i < 7; i++) {
        const line = box(
          i % 3 === 0 ? 0.026 : 0.014,
          0.13,
          0.012,
          ink,
          shippingLabel,
        );
        line.position.set(-0.2 + i * 0.057, -0.03, 0.028);
      }
      box(0.18, 0.023, 0.012, ink, shippingLabel).position.set(
        -0.1,
        0.105,
        0.028,
      );

      const eyes: Three.Group[] = [];
      const pupils: Three.Mesh[] = [];
      const eyeGeometry = new THREE.SphereGeometry(1, 28, 20);
      for (const x of [-0.57, 0.57]) {
        const eye = new THREE.Group();
        eye.position.set(x, 0.29, 1.065);
        pip.add(eye);
        eyes.push(eye);
        const sclera = mesh(eyeGeometry, white, eye);
        sclera.scale.set(0.3, 0.4, 0.13);
        const pupil = mesh(eyeGeometry, ink, eye);
        pupil.scale.set(0.135, 0.23, 0.075);
        pupil.position.set(0.04, -0.015, 0.115);
        pupils.push(pupil);
        const glint = mesh(eyeGeometry, white, pupil);
        glint.scale.set(0.2, 0.19, 0.22);
        glint.position.set(-0.29, 0.29, 0.88);
        const brow = mesh(
          roundedGeometry(0.37, 0.065, 0.035, 0.03, 0.008),
          ink,
          pip,
        );
        brow.position.set(x, 0.89 + (x > 0 ? 0.02 : 0), 1.074);
        brow.rotation.z = x > 0 ? -0.14 : 0.12;
      }
      const smileCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-0.23, -0.34, 1.079),
        new THREE.Vector3(0.025, -0.56, 1.084),
        new THREE.Vector3(0.25, -0.3, 1.079),
      );
      mesh(new THREE.TubeGeometry(smileCurve, 20, 0.027, 8, false), ink, pip);

      // The closed conveyor is a supply-network motif, not a live shipment trace.
      const route = new THREE.CatmullRomCurve3(
        Array.from({ length: 40 }, (_, index) => {
          const angle = (index / 40) * Math.PI * 2;
          return new THREE.Vector3(
            4.05 * Math.cos(angle),
            -0.57 + Math.sin(angle) * 0.12,
            2.65 * Math.sin(angle),
          );
        }),
        true,
        "centripetal",
      );
      mesh(new THREE.TubeGeometry(route, 180, 0.105, 10, true), cobalt);
      const outerRoute = new THREE.CatmullRomCurve3(
        Array.from({ length: 40 }, (_, index) => {
          const angle = (index / 40) * Math.PI * 2;
          return new THREE.Vector3(
            4.24 * Math.cos(angle),
            -0.61 + Math.sin(angle) * 0.12,
            2.84 * Math.sin(angle),
          );
        }),
        true,
        "centripetal",
      );
      mesh(new THREE.TubeGeometry(outerRoute, 180, 0.024, 6, true), paleBlue);
      for (let i = 0; i < 16; i++) {
        const phase = i / 16;
        const point = route.getPointAt(phase);
        const tie = box(0.27, 0.035, 0.065, cobalt);
        tie.position.copy(point);
        tie.position.y -= 0.07;
        const tangent = route.getTangentAt(phase);
        tie.rotation.y = Math.atan2(tangent.x, tangent.z);
      }

      const parcels: Three.Group[] = [];
      const parcelGeometry = roundedGeometry(0.32, 0.33, 0.32, 0.035, 0.018);
      for (let i = 0; i < 5; i++) {
        const parcel = new THREE.Group();
        world.add(parcel);
        mesh(parcelGeometry, lime, parcel);
        box(0.055, 0.014, 0.32, ink, parcel).position.y = 0.189;
        box(0.055, 0.33, 0.014, ink, parcel).position.z = 0.189;
        box(0.09, 0.08, 0.015, white, parcel).position.set(0.085, 0.03, 0.193);
        parcels.push(parcel);
      }

      const depotPositions = [
        new THREE.Vector3(-3.15, -0.62, 0.63),
        new THREE.Vector3(2.48, -0.62, -1.65),
        new THREE.Vector3(2.65, -0.62, 1.64),
      ];
      const depotAccents: Three.MeshStandardMaterial[] = [];
      const depots: Three.Group[] = [];
      for (let index = 0; index < nodeCount; index++) {
        const depot = new THREE.Group();
        depot.position.copy(depotPositions[index]);
        depot.rotation.y = index === 0 ? 0.15 : -0.25;
        depot.userData.nodeIndex = index;
        world.add(depot);
        depots.push(depot);
        const accent = material(
          index === selected.current ? COLORS.cobalt : "#b9c9fb",
          0.5,
        );
        depotAccents.push(accent);
        const plinth = box(1.5, 0.12, 1.35, white, depot);
        plinth.position.y = -0.42;
        box(1.22, 0.78, 0.92, white, depot).position.set(0, 0.02, -0.08);
        // Sawtooth roof, clerestory glazing, loading bay and a cantilever canopy.
        const roofShape = new THREE.Shape();
        roofShape.moveTo(-0.67, 0);
        roofShape.lineTo(-0.67, 0.27);
        roofShape.lineTo(0.02, 0.06);
        roofShape.lineTo(0.02, 0.27);
        roofShape.lineTo(0.67, 0.06);
        roofShape.lineTo(0.67, 0);
        roofShape.closePath();
        const roofGeometry = new THREE.ExtrudeGeometry(roofShape, {
          depth: 1.01,
          bevelEnabled: false,
        });
        roofGeometry.translate(0, 0, -0.505);
        const roof = mesh(roofGeometry, white, depot);
        roof.position.set(0, 0.41, -0.08);
        box(0.035, 0.17, 0.94, accent, depot).position.set(-0.675, 0.57, -0.08);
        box(0.035, 0.17, 0.94, accent, depot).position.set(0.015, 0.57, -0.08);
        const bay = box(0.53, 0.48, 0.03, accent, depot);
        bay.position.set(-0.2, -0.06, 0.399);
        for (let line = 0; line < 4; line++) {
          box(0.49, 0.012, 0.015, white, depot).position.set(
            -0.2,
            -0.22 + line * 0.108,
            0.419,
          );
        }
        box(0.2, 0.41, 0.035, ink, depot).position.set(0.38, -0.1, 0.4);
        box(1.39, 0.065, 0.37, accent, depot).position.set(0, 0.39, 0.51);
        for (const x of [-0.59, 0.59]) {
          box(0.045, 0.68, 0.045, white, depot).position.set(x, 0.01, 0.65);
        }
        box(0.26, 0.045, 0.02, ink, depot).position.set(-0.2, 0.28, 0.407);
        const parcel = box(0.18, 0.2, 0.19, lime, depot);
        parcel.position.set(-0.5, -0.25, 0.52);
        box(0.035, 0.21, 0.2, ink, depot).position.copy(parcel.position);
      }

      const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const finePointer = window.matchMedia("(pointer: fine)");
      const pointer = new THREE.Vector2();
      const pointerTarget = new THREE.Vector2();
      const neutralPointer = new THREE.Vector2();
      const raycaster = new THREE.Raycaster();
      const routePoint = new THREE.Vector3();
      const routeTangent = new THREE.Vector3();
      let frame = 0;
      let previousTime: number | null = null;
      let elapsed = 0;
      let visible = true;
      let contextLost = false;
      let width = 1;
      let height = 1;
      let pointerStart: { x: number; y: number } | null = null;
      const canAnimate = () =>
        !disposed &&
        !contextLost &&
        !pause.current &&
        !motion.matches &&
        visible &&
        !document.hidden;

      const render = (timestamp?: number) => {
        if (disposed || contextLost) return;
        if (timestamp !== undefined && Number.isFinite(timestamp)) {
          const delta =
            previousTime === null
              ? 0
              : Math.max(0, Math.min((timestamp - previousTime) / 1000, 0.05));
          previousTime = timestamp;
          if (canAnimate()) elapsed += delta;
        }
        const moving = !motion.matches;
        if (moving && !pause.current) pointer.lerp(pointerTarget, 0.075);
        else if (!moving) pointer.copy(neutralPointer);
        camera.position.set(
          cameraOrigin.x + pointer.x * 0.34,
          cameraOrigin.y + pointer.y * 0.2,
          cameraOrigin.z,
        );
        camera.lookAt(cameraTarget);
        pip.position.y = 1.03 + (moving ? Math.sin(elapsed * 1.2) * 0.075 : 0);
        pip.rotation.z =
          -0.065 + (moving ? Math.sin(elapsed * 0.7) * 0.018 : 0);
        const blinkPhase = elapsed % 5.8;
        const blink =
          moving && blinkPhase > 5.53
            ? 1 - Math.sin(((blinkPhase - 5.53) / 0.27) * Math.PI) * 0.94
            : 1;
        eyes.forEach((eye) => {
          eye.scale.y = blink;
        });
        pupils.forEach((pupil) => {
          pupil.position.x = 0.04 + pointer.x * 0.055;
          pupil.position.y = -0.015 + pointer.y * 0.04;
        });
        parcels.forEach((parcel, index) => {
          const rawPhase = index / parcels.length + elapsed * 0.026 + 0.065;
          const phase = Number.isFinite(rawPhase)
            ? ((rawPhase % 1) + 1) % 1
            : 0;
          route.getPointAt(phase, routePoint);
          route.getTangentAt(phase, routeTangent);
          parcel.position.copy(routePoint);
          parcel.position.y += 0.27;
          parcel.rotation.y = Math.atan2(routeTangent.x, routeTangent.z);
        });
        depotAccents.forEach((accent, index) => {
          accent.color.set(
            index === selected.current ? COLORS.cobalt : "#b9c9fb",
          );
        });
        renderer.render(scene, camera);
      };
      const tick = (timestamp: number) => {
        frame = 0;
        render(timestamp);
        if (canAnimate()) frame = window.requestAnimationFrame(tick);
      };
      const synchronize = () => {
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        previousTime = null;
        if (disposed || contextLost) return;
        render();
        if (canAnimate()) frame = window.requestAnimationFrame(tick);
      };
      update.current = () => render();
      playback.current = synchronize;
      const resize = () => {
        if (disposed || contextLost) return;
        width = Math.max(1, container.clientWidth);
        height = Math.max(1, container.clientHeight);
        const aspect = width / height;
        const viewHeight = Math.max(6.65, 8.65 / aspect);
        camera.left = -(viewHeight * aspect) / 2;
        camera.right = (viewHeight * aspect) / 2;
        camera.top = viewHeight / 2;
        camera.bottom = -viewHeight / 2;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        // setSize clears the framebuffer; a paused scene still needs an immediate paint.
        render();
      };
      const getNode = (event: PointerEvent) => {
        const bounds = container.getBoundingClientRect();
        const position = new THREE.Vector2(
          ((event.clientX - bounds.left) / width) * 2 - 1,
          -((event.clientY - bounds.top) / height) * 2 + 1,
        );
        raycaster.setFromCamera(position, camera);
        const hit = raycaster.intersectObjects(depots, true)[0];
        let object: Three.Object3D | null = hit?.object ?? null;
        while (object) {
          if (typeof object.userData.nodeIndex === "number")
            return object.userData.nodeIndex as number;
          object = object.parent;
        }
        return null;
      };
      const onPointerMove = (event: PointerEvent) => {
        if (finePointer.matches && !motion.matches && !pause.current) {
          const bounds = container.getBoundingClientRect();
          pointerTarget.set(
            Math.max(
              -1,
              Math.min(1, ((event.clientX - bounds.left) / width) * 2 - 1),
            ),
            Math.max(
              -1,
              Math.min(1, 1 - ((event.clientY - bounds.top) / height) * 2),
            ),
          );
        }
        renderer.domElement.style.cursor =
          getNode(event) === null ? "default" : "pointer";
      };
      const onPointerLeave = () => {
        pointerTarget.set(0, 0);
      };
      const onPointerDown = (event: PointerEvent) => {
        pointerStart = { x: event.clientX, y: event.clientY };
      };
      const onPointerUp = (event: PointerEvent) => {
        const origin = pointerStart;
        pointerStart = null;
        if (
          !origin ||
          Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 7
        )
          return;
        const index = getNode(event);
        if (index !== null) select.current(index);
      };
      const onContextLost = (event: Event) => {
        event.preventDefault();
        contextLost = true;
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        setReady(false);
      };
      const onContextRestored = () => {
        contextLost = false;
        resize();
        synchronize();
        setReady(true);
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      const intersectionObserver = new IntersectionObserver(
        ([entry]) => {
          visible = entry?.isIntersecting ?? true;
          synchronize();
        },
        { rootMargin: "80px" },
      );
      intersectionObserver.observe(container);
      document.addEventListener("visibilitychange", synchronize);
      motion.addEventListener("change", synchronize);
      container.addEventListener("pointermove", onPointerMove);
      container.addEventListener("pointerleave", onPointerLeave);
      container.addEventListener("pointerdown", onPointerDown);
      container.addEventListener("pointerup", onPointerUp);
      renderer.domElement.addEventListener("webglcontextlost", onContextLost);
      renderer.domElement.addEventListener(
        "webglcontextrestored",
        onContextRestored,
      );
      destroy = () => {
        if (frame) window.cancelAnimationFrame(frame);
        update.current = null;
        playback.current = null;
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        document.removeEventListener("visibilitychange", synchronize);
        motion.removeEventListener("change", synchronize);
        container.removeEventListener("pointermove", onPointerMove);
        container.removeEventListener("pointerleave", onPointerLeave);
        container.removeEventListener("pointerdown", onPointerDown);
        container.removeEventListener("pointerup", onPointerUp);
        renderer.domElement.removeEventListener(
          "webglcontextlost",
          onContextLost,
        );
        renderer.domElement.removeEventListener(
          "webglcontextrestored",
          onContextRestored,
        );
        disposeResources();
      };
      resize();
      synchronize();
      if (!disposed) setReady(true);
    };
    initialize().catch(() => {
      destroy();
      if (!disposed) setReady(false);
    });
    return () => {
      disposed = true;
      destroy();
    };
  }, [nodeCount]);

  return (
    <figure
      className="pip-supply-sculpture"
      data-ready={ready ? "true" : "false"}
      aria-label="Pip connects your fulfilment locations"
    >
      <div className="pip-supply-sculpture__art">
        <div className="pip-supply-sculpture__fallback" aria-hidden="true">
          <div className="pip-supply-sculpture__fallback-orbit" />
          <div className="pip-supply-sculpture__fallback-parcel">
            <i />
            <i />
            <span />
          </div>
          {[0, 1, 2].slice(0, nodeCount).map((index) => (
            <div
              className={`pip-supply-sculpture__fallback-depot pip-supply-sculpture__fallback-depot--${index}`}
              key={index}
            />
          ))}
        </div>
        <div ref={host} className="pip-supply-sculpture__canvas" />
        {ready && (
          <button
            type="button"
            className="pip-supply-sculpture__motion"
            title={userPaused ? "Resume animation" : "Pause animation"}
            aria-label={userPaused ? "Resume animation" : "Pause animation"}
            aria-pressed={userPaused}
            onClick={() => setUserPaused((value) => !value)}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              {userPaused ? (
                <path
                  d="m5.5 3.5 6 4.5-6 4.5v-9Z"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeLinejoin="round"
                />
              ) : (
                <path
                  d="M5.5 4v8M10.5 4v8"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        )}
      </div>
      <figcaption className="pip-supply-sculpture__caption">
        <span className="pip-supply-sculpture__eyebrow">
          One connected network
        </span>
        <div
          className="pip-supply-sculpture__locations"
          role="group"
          aria-label="Select a fulfilment location"
        >
          {nodes.slice(0, 3).map((node, index) => (
            <button
              type="button"
              className="pip-supply-sculpture__location"
              key={node.id}
              aria-pressed={selectedNode === index}
              onClick={() => onSelectNode(index)}
            >
              <span
                className="pip-supply-sculpture__location-number"
                aria-hidden="true"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{node.city}</span>
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M3 8h10M8 3l5 5-5 5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </button>
          ))}
        </div>
      </figcaption>
    </figure>
  );
}
