"use client";

import { useId } from "react";

/** Pip: a small, reassuring companion for a busy purchasing day. */
export function Mascot({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const paint = (name: string) => `url(#${id}-${name})`;

  return (
    <svg
      className={className}
      width={compact ? 50 : 280}
      height={compact ? 50 : 240}
      viewBox={compact ? "69 22 144 144" : "0 0 280 240"}
      fill="none"
      role="img"
      aria-label="Pip, your friendly purchasing companion"
    >
      <defs>
        <linearGradient
          id={`${id}-shell`}
          x1="98"
          y1="46"
          x2="184"
          y2="155"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFFDFE" />
          <stop offset=".4" stopColor="#F0EBFF" />
          <stop offset="1" stopColor="#CDC1EA" />
        </linearGradient>
        <linearGradient
          id={`${id}-face`}
          x1="112"
          y1="66"
          x2="166"
          y2="125"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#FBF8FF" />
        </linearGradient>
        <linearGradient
          id={`${id}-body`}
          x1="105"
          y1="133"
          x2="168"
          y2="200"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#F7F1FF" />
          <stop offset=".45" stopColor="#E2D5F6" />
          <stop offset="1" stopColor="#B59CD8" />
        </linearGradient>
        <linearGradient
          id={`${id}-peach`}
          x1="60"
          y1="139"
          x2="114"
          y2="190"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#F8E5DF" />
          <stop offset="1" stopColor="#E4B8AC" />
        </linearGradient>
        <linearGradient
          id={`${id}-hand`}
          x1="197"
          y1="112"
          x2="218"
          y2="145"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FCF9FF" />
          <stop offset="1" stopColor="#D8C9EE" />
        </linearGradient>
        <radialGradient id={`${id}-shadow`}>
          <stop stopColor="#554075" stopOpacity=".21" />
          <stop offset="1" stopColor="#554075" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-antenna`} cx=".32" cy=".25" r=".8">
          <stop stopColor="#F8EFFF" />
          <stop offset=".65" stopColor="#DCC4F3" />
          <stop offset="1" stopColor="#B89ED9" />
        </radialGradient>
        <filter
          id={`${id}-soft-shadow`}
          x="-30%"
          y="-25%"
          width="160%"
          height="170%"
        >
          <feDropShadow
            dx="0"
            dy="7"
            stdDeviation="5"
            floodColor="#65517F"
            floodOpacity=".15"
          />
        </filter>
      </defs>

      {!compact && (
        <g aria-hidden="true">
          <ellipse cx="143" cy="216" rx="86" ry="16" fill={paint("shadow")} />
          <circle cx="57" cy="73" r="5" fill="#E5D9FA" />
          <circle cx="230" cy="166" r="4" fill="#F0D7CD" />
          <path
            d="M224 48v12m-6-6h12"
            stroke="#BEA4E2"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M43 118v8m-4-4h8"
            stroke="#DFBCB0"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="196" cy="28" r="2.5" fill="#EFE7FC" />
        </g>
      )}

      <g filter={paint("soft-shadow")}>
        {!compact && (
          <>
            {/* Little feet and the curved arm holding a parcel. */}
            <rect
              x="111"
              y="184"
              width="24"
              height="25"
              rx="12"
              fill={paint("shell")}
              transform="rotate(8 123 196)"
            />
            <rect
              x="152"
              y="184"
              width="24"
              height="25"
              rx="12"
              fill={paint("shell")}
              transform="rotate(-8 164 196)"
            />
            <path
              d="M112 149c-11-2-18 4-21 17"
              stroke="#D7C9EA"
              strokeWidth="19"
              strokeLinecap="round"
            />
            {/* A raised arm makes Pip feel welcoming without requiring motion. */}
            <path
              d="M174 151c19 4 29-5 32-24"
              stroke="#BDA8DC"
              strokeWidth="19"
              strokeLinecap="round"
            />
            <path
              d="M173 148c17 3 26-5 29-21"
              stroke="#F0E8FC"
              strokeWidth="12"
              strokeLinecap="round"
            />
            <path
              d="M201 132c-8-5-11-14-8-20 2-4 6-4 8 0l2 4 1-15c0-5 6-5 7 0l1 12 4-9c2-4 7-2 6 2l-2 12 4-3c4-2 7 2 4 6l-10 12c-4 4-12 3-17-1Z"
              fill={paint("hand")}
              stroke="#D9C9EC"
              strokeWidth="1"
            />
            <path
              d="M198 115c-1 6 2 10 5 12"
              stroke="white"
              strokeOpacity=".7"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </>
        )}

        <rect
          x="106"
          y="131"
          width="74"
          height="64"
          rx="27"
          fill={paint("body")}
        />
        <path
          d="M116 149c2-7 9-10 16-10h22"
          stroke="white"
          strokeOpacity=".7"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <rect
          x="124"
          y="152"
          width="37"
          height="23"
          rx="11.5"
          fill="#FCF8FF"
          fillOpacity=".8"
        />
        <path
          d="m135 163 5 4 9-9"
          stroke="#8565A9"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Antenna, ears, and pillowy rounded head. */}
        <path
          d="M142 48V33"
          stroke="#C5B3E0"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <circle cx="142" cy="29" r="9" fill={paint("antenna")} />
        <circle cx="139.5" cy="26.5" r="2.4" fill="white" fillOpacity=".8" />
        <rect x="75" y="82" width="19" height="34" rx="9.5" fill="#D7C8EB" />
        <rect x="190" y="82" width="19" height="34" rx="9.5" fill="#C9B5E4" />
        <rect x="80" y="87" width="8" height="22" rx="4" fill="#FAF5FF" />
        <rect x="197" y="87" width="6" height="22" rx="3" fill="#F0E7FC" />
        <rect
          x="85"
          y="45"
          width="114"
          height="101"
          rx="40"
          fill={paint("shell")}
          stroke="#E2D5F1"
          strokeWidth="1"
        />
        <path
          d="M98 72c4-12 14-18 29-18h29"
          stroke="white"
          strokeOpacity=".85"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <rect
          x="96"
          y="64"
          width="92"
          height="66"
          rx="27"
          fill={paint("face")}
          stroke="white"
          strokeWidth="2"
        />

        {/* Friendly eyes, peach cheeks, and a small, confident smile. */}
        <ellipse cx="122" cy="94" rx="6" ry="9" fill="#382548" />
        <ellipse cx="162" cy="94" rx="6" ry="9" fill="#382548" />
        <circle cx="124" cy="91" r="1.8" fill="white" />
        <circle cx="164" cy="91" r="1.8" fill="white" />
        <ellipse
          cx="111"
          cy="108"
          rx="8"
          ry="4.5"
          fill="#F1D1C5"
          fillOpacity=".8"
        />
        <ellipse
          cx="173"
          cy="108"
          rx="8"
          ry="4.5"
          fill="#F1D1C5"
          fillOpacity=".8"
        />
        <path
          d="M135 109c4 5 10 5 14 0"
          stroke="#6A527E"
          strokeWidth="2.8"
          strokeLinecap="round"
        />

        {!compact && (
          <g transform="rotate(-10 86 167)">
            <rect
              x="58"
              y="143"
              width="57"
              height="47"
              rx="9"
              fill={paint("peach")}
              stroke="#DEB6AA"
              strokeWidth="1"
            />
            <path d="M58 157h57" stroke="#CCA395" strokeWidth="1" />
            <path
              d="M80 143h13v21l-6.5-4-6.5 4v-21Z"
              fill="#FFF5F0"
              fillOpacity=".9"
            />
            <path
              d="M67 179h12"
              stroke="#AD8177"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M67 174h7"
              stroke="#AD8177"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <rect
              x="104"
              y="160"
              width="14"
              height="21"
              rx="7"
              fill={paint("shell")}
            />
          </g>
        )}
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
          <stop stopColor="#F4EBFF" />
          <stop offset="1" stopColor="#DCCDF0" />
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
        <path d="M10 65c0-14 8-23 22-23s22 9 22 23" fill="#B8A2D9" />
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
          stroke="#EEE4FA"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
