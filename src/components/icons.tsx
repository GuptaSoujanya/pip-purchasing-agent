import type { SVGProps } from "react";
import {
  IconLayoutDashboard,
  IconArrowsShuffle,
  IconActivity,
  IconClipboardCheck,
  IconReceipt,
  IconBox,
  IconChartBar,
  IconArrowRight,
  IconSearch,
  IconBell,
  IconChevronRight,
  IconWallet,
  IconClock,
  IconShieldCheck,
  IconSun,
  IconMenu2,
  IconX,
  IconHelpCircle,
  IconBuildingWarehouse,
  IconCalendar,
  IconArrowUpRight,
} from "@tabler/icons-react";

const icons = {
  grid: IconLayoutDashboard,
  workflow: IconArrowsShuffle,
  sparkles: IconArrowsShuffle,
  activity: IconActivity,
  check: IconClipboardCheck,
  orders: IconReceipt,
  box: IconBox,
  chart: IconChartBar,
  arrow: IconArrowRight,
  search: IconSearch,
  bell: IconBell,
  chevron: IconChevronRight,
  wallet: IconWallet,
  clock: IconClock,
  shield: IconShieldCheck,
  sun: IconSun,
  menu: IconMenu2,
  close: IconX,
  help: IconHelpCircle,
  warehouse: IconBuildingWarehouse,
  calendar: IconCalendar,
  "arrow-up-right": IconArrowUpRight,
};
export type IconName = keyof typeof icons;
export function Icon({
  name,
  size = 18,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  const Component = icons[name];
  return (
    <Component
      width={size}
      height={size}
      stroke={1.75}
      aria-hidden="true"
      {...props}
    />
  );
}
