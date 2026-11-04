"use client";
import { useId } from "react";
import "./companion.css";

/** Pip is a parcel with a point of view — the same character as the supply sculpture. */
export function Mascot({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className={"pip-mascot " + className}
      width={compact ? 50 : 240}
      height={compact ? 50 : 240}
      viewBox="0 0 160 160"
      fill="none"
      role="img"
      aria-label="Pip, your purchasing companion"
    >
      <defs>
        <linearGradient
          id={id + "-parcel"}
          x1="38"
          y1="38"
          x2="125"
          y2="132"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ff8a61" />
          <stop offset=".6" stopColor="#f6623e" />
          <stop offset="1" stopColor="#dc4729" />
        </linearGradient>
        <linearGradient
          id={id + "-label"}
          x1="52"
          y1="65"
          x2="115"
          y2="112"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fffdf8" />
          <stop offset="1" stopColor="#f2efdf" />
        </linearGradient>
        <filter
          id={id + "-shadow"}
          x="-40%"
          y="-30%"
          width="180%"
          height="190%"
        >
          <feDropShadow
            dx="0"
            dy="5"
            stdDeviation="3"
            floodColor="#20231f"
            floodOpacity=".12"
          />
        </filter>
      </defs>
      <ellipse cx="84" cy="146" rx="43" ry="5" fill="#20231f" opacity=".09" />
      <g filter={"url(#" + id + "-shadow)"} className="pip-mascot-body">
        <rect
          x="48"
          y="126"
          width="22"
          height="18"
          rx="8"
          fill="#2449ef"
          transform="rotate(5 59 135)"
        />
        <rect
          x="100"
          y="126"
          width="22"
          height="18"
          rx="8"
          fill="#2449ef"
          transform="rotate(-5 111 135)"
        />
        <rect
          x="21"
          y="77"
          width="19"
          height="35"
          rx="9"
          fill="#f6623e"
          transform="rotate(12 30 95)"
        />
        <g className="pip-mascot-hand">
          <rect
            x="130"
            y="68"
            width="18"
            height="35"
            rx="9"
            fill="#f6623e"
            transform="rotate(-18 139 85)"
          />
          <path
            d="M138 72v-9m5 12 5-5"
            stroke="#f6623e"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </g>
        <path
          d="M49 29h66l21 14v75c0 11-10 19-21 19H55c-11 0-20-9-20-20V49c0-10 5-17 14-20Z"
          fill="#d64e2f"
        />
        <path d="m49 29 66 0 18 13-78 6-18-6c2-6 6-11 12-13Z" fill="#ff9b72" />
        <rect
          x="34"
          y="39"
          width="91"
          height="97"
          rx="22"
          fill={"url(#" + id + "-parcel)"}
        />
        <path d="m73 29 19 0 13 10H84L73 29Z" fill="#5270ff" />
        <path d="M78 39h20v21l-10-5-10 5V39Z" fill="#2449ef" />
        <path
          d="M45 59c0-6 5-10 11-10h8"
          stroke="#ffc3a5"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect
          x="46"
          y="65"
          width="67"
          height="48"
          rx="17"
          fill={"url(#" + id + "-label)"}
        />
        <g className="pip-mascot-eyes">
          <rect x="61" y="79" width="8" height="13" rx="4" fill="#20231f" />
          <rect x="91" y="79" width="8" height="13" rx="4" fill="#20231f" />
          <circle cx="63.4" cy="82" r="1.3" fill="white" />
          <circle cx="93.4" cy="82" r="1.3" fill="white" />
        </g>
        <path
          d="M74 99c4 4 9 4 13 0"
          stroke="#20231f"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M60 122v6m4-6v6m3-6v6m6-6v6m3-6v6m3-6v6m5-6v6m3-6v6m5-6v6m3-6v6"
          stroke="#fff3da"
          strokeWidth="1.5"
        />
        <circle cx="107" cy="124" r="4" fill="#d9ed82" />
      </g>
    </svg>
  );
}

export function BuyerAvatar({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className={className}
      width="44"
      height="44"
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Buyer profile avatar"
    >
      <defs>
        <linearGradient
          id={`${id}-background`}
          x1="8"
          y1="4"
          x2="58"
          y2="64"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ebf0d5" />
          <stop offset="1" stopColor="#cdda9f" />
        </linearGradient>
        <linearGradient
          id={`${id}-skin`}
          x1="22"
          y1="20"
          x2="43"
          y2="48"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFE1CC" />
          <stop offset="1" stopColor="#ECAF94" />
        </linearGradient>
        <clipPath id={`${id}-circle`}>
          <circle cx="32" cy="32" r="30" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="31" fill="white" />
      <g clipPath={`url(#${id}-circle)`}>
        <circle cx="32" cy="32" r="30" fill={`url(#${id}-background)`} />
        <path
          d="M16 37V27c0-13 7-18 16-18 11 0 17 7 17 19v15H16v-6Z"
          fill="#4D3C56"
        />
        <path d="M10 65c0-14 8-23 22-23s22 9 22 23" fill="#2449ef" />
        <path d="M25 40h14v8c-4 6-10 6-14 0v-8Z" fill="#E8A78E" />
        <ellipse cx="19" cy="32" rx="3" ry="4" fill="#EFB99C" />
        <ellipse cx="45" cy="32" rx="3" ry="4" fill="#EFB99C" />
        <path
          d="M19 25c0-10 26-10 26 0v10c0 8-6 13-13 13s-13-5-13-13V25Z"
          fill={`url(#${id}-skin)`}
        />
        <path
          d="M18 28c1-11 5-17 15-17 9 0 14 6 14 16-9 0-15-4-19-9-1 6-5 9-10 10Z"
          fill="#4D3C56"
        />
        <path
          d="M23 16c4-4 10-5 15-2"
          stroke="#705A7F"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <ellipse cx="26" cy="32" rx="1.5" ry="2" fill="#4B3D4D" />
        <ellipse cx="38" cy="32" rx="1.5" ry="2" fill="#4B3D4D" />
        <path
          d="M29 39c2 2 4 2 6 0"
          stroke="#AD6D68"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <ellipse cx="23" cy="37" rx="3" ry="1.7" fill="#ECA68F" />
        <ellipse cx="41" cy="37" rx="3" ry="1.7" fill="#ECA68F" />
        <path
          d="m22 49 10 7 10-7"
          stroke="#d9ed82"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
