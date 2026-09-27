import {
  BookOpen,
  Briefcase,
  Code2,
  Heart,
  Megaphone,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * "Who this is for" - the two audiences, plus the users around them.
 *
 * The brief asked for both primary audiences *and* the real-world users around
 * them. The way to do that without turning the page into a taxonomy is to keep
 * two columns (the lens) and put the adjacent roles underneath the column they
 * actually use, as an "also in here" line. A freelancer and a product manager
 * both arrive as *non-technical builders*; naming them here is what stops the
 * pitch sounding like the product only has two kinds of customer.
 */
export interface Adjacent {
  icon: LucideIcon;
  who: string;
  how: string;
}

export interface Lens {
  id: "simple" | "developer";
  label: string;
  headline: string;
  body: string;
  flow: string[];
  gets: string[];
  adjacent: Adjacent[];
}

export const LENSES: Lens[] = [
  {
    id: "simple",
    label: "If you do not write code",
    headline: "Say what you want. Watch it appear.",
    body: "You describe the app the way you would describe it to a contractor. A team of specialists builds it, shows you the screens as they are made, and asks you only when there is a real decision to make.",
    flow: [
      "Write one or two sentences",
      "Watch the screens get built, live",
      "Say make it blue instead",
      "Put it online and share the link",
    ],
    gets: [
      "Plain-language status at every step",
      "A live preview, not a code dump",
      "One button to undo the last change",
      "You never have to read a diff to use it",
    ],
    adjacent: [
      {
        icon: Briefcase,
        who: "Freelancers",
        how: "Quote a client a working prototype the same afternoon.",
      },
      {
        icon: Heart,
        who: "Clinics, studios, small teams",
        how: "Order a small internal tool nobody has time to build.",
      },
      {
        icon: Megaphone,
        who: "Marketers and operators",
        how: "Ship a landing page or a booking flow for a campaign.",
      },
    ],
  },
  {
    id: "developer",
    label: "If you do write code",
    headline: "Your repo, with agents that already know it.",
    body: "Import the repository you already ship. The agents read it before they change it, run on the models you choose, and show you every file they touched. Push the branch yourself when you are happy.",
    flow: [
      "Connect GitHub, pick a repository",
      "Let the agents read and map the codebase",
      "Review the graph, the model per agent, the diff",
      "Push a branch, or deploy from the commit",
    ],
    gets: [
      "The orchestration graph: nodes, handoffs, models",
      "Every file the agents wrote, with a diff",
      "Model selection per agent, not a global setting",
      "Environment variables, deploys and rollback",
    ],
    adjacent: [
      {
        icon: Wrench,
        who: "Solo developers",
        how: "Add a feature without leaving the editor or the branch.",
      },
      {
        icon: BookOpen,
        who: "Agencies and consultancies",
        how: "Hand a client a working repo, not a PDF of screenshots.",
      },
      {
        icon: Code2,
        who: "Tech leads",
        how: "Standardise how a feature gets built across a team.",
      },
    ],
  },
];
