import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Loader2, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { User } from '../types/User';
import type { Group } from '../types/Group';
import type { Rule, RuleTarget } from '../types/Rule';
import type {
  AssistantChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from '../types/openaiChat';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { createOpenAIChatCompletion } from '../utils/openaiProxy';
import { normalizeUrl } from '../utils/urlNormalization';
import { syncRulesToStorage } from '../utils/syncRulesToStorage';
import { formatUrlForDisplay } from '../utils/urlDisplay';
import { TUTORIAL_GROUP_NAME, TUTORIAL_RULE_NAME, TUTORIAL_SOCIAL_URLS } from '../constants';

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolArgs?: unknown;
  // Store the actual OpenAI message format for proper conversation history
  openAiMessage?: ChatCompletionMessageParam;
}

interface PersistedMessage {
  role?: Message['role'];
  content?: string;
  toolName?: string;
  toolArgs?: unknown;
  openAiMessage?: ChatCompletionMessageParam;
}

interface ToolCallDisplay {
  name: string;
  args: unknown;
  result: string;
}

interface LLMPanelProps {
  user: User | null;
  onCollapse?: () => void;
  tutorialExpectedPrompt?: string;
  onTutorialPromptAccepted?: () => void;
  onTutorialPromptMismatch?: (isMismatch: boolean) => void;
  onAiChatFocus?: () => void;
  onAiChatBlur?: () => void;
}

const markdownComponents: Components = {
  p: ({ children }) => (
    <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-zinc-100">{children}</em>
  ),
  a: ({ children, href }) => (
    <a
      className="text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:text-sky-200"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  code: ({ children, className }) => {
    const isCodeBlock = Boolean(className);

    return (
      <code
        className={
          isCodeBlock
            ? `${className} block overflow-x-auto whitespace-pre rounded bg-zinc-950/80 px-2 py-1.5 text-xs text-zinc-100`
            : 'rounded bg-zinc-950/70 px-1 py-0.5 font-mono text-[0.85em] text-zinc-100'
        }
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto">{children}</pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-zinc-500 pl-3 text-zinc-300">
      {children}
    </blockquote>
  ),
};

const markdownPlugins = [remarkGfm, remarkBreaks];

const MarkdownMessage: React.FC<{ content: string }> = ({ content }) => (
  <div className="break-words">
    <ReactMarkdown components={markdownComponents} remarkPlugins={markdownPlugins}>
      {content}
    </ReactMarkdown>
  </div>
);

const AI_CHAT_SYSTEM_PROMPT = `You help users manage website groups and time rules. Your job is to choose the correct tool calls, not to chat at length.

Decision rules:
1. First decide whether the rule type is known. If the user wants a rule but the rule type is missing, ask the clarification question in rule 5 immediately. Do not call get_groups_and_rules first.
2. Once the action and rule type are clear, call get_groups_and_rules before every create, update, or delete request and wait for the result. Do not call any create/update/delete tool in the same assistant message as get_groups_and_rules.
3. After get_groups_and_rules returns, use the existing group/rule names from that result. Update existing matching items; do not create duplicates.
4. If the user asks to create a rule for one explicit site, call create_rule with a url target. If the user asks for a category or a set of related sites, create or reuse a group, then create_rule with a group target.
5. Rule type mapping:
   - hard: user says hard, strict, block, blocking, or no access after time runs out.
   - soft: user says soft, flexible, allow extensions, plus-ones, or "one more".
   - session: user says session, per visit, ask me each time, or choose time when I open it.
6. If the user wants a rule but the rule type is missing, ask exactly one clarification question and do not call tools: "Should this be hard, soft, or session? Hard blocks access after time runs out, soft allows extensions, and session asks each visit."
7. Defaults only after rule type is known:
   - Hard rule with no time: timeLimit 60.
   - Soft rule with no time: timeLimit 60, plusOnes 3, plusOneDuration 300.
   - Soft rule with plus-one count but no plus-one duration: plusOneDuration 300.
   - Session rule: omit timeLimit, plusOnes, and plusOneDuration.
8. URL rules: use lowercase bare domains only, without https:// or www. Use youtube.com, not https://www.youtube.com.
9. Common category defaults:
   - Social Media group: instagram.com, tiktok.com, facebook.com, x.com, twitter.com, reddit.com, snapchat.com.
   - Video Sites group: youtube.com, netflix.com, hulu.com, disneyplus.com, twitch.tv.
   - News group: nytimes.com, washingtonpost.com, cnn.com, foxnews.com, bbc.com, theguardian.com.
10. When adding or removing individual URLs from an existing rule, call update_rule with addUrls or removeUrls. Do not create a new rule.
11. Keep final responses brief and confirm exactly what changed.`;

// Define OpenAI function tools
const tools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_groups_and_rules',
      description: 'Retrieves all existing groups and rules. Use this after the requested action and rule type are clear. If the user wants a rule but has not specified hard, soft, or session, ask a clarification question instead of calling this.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_group',
      description: 'Creates a new group of websites after get_groups_and_rules confirms the group does not already exist. Use groups for categories or related sets of sites that should share one rule.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The group name, using title case (e.g., "Social Media", "Video Sites", "News")'
          },
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bare lowercase domains only, without https:// or www. (e.g., ["youtube.com", "instagram.com"]).'
          }
        },
        required: ['name', 'urls']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_rule',
      description: 'Creates a time rule after get_groups_and_rules confirms no matching rule exists. Use a url target for one explicit site, and a group target for an existing or newly created category group.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Optional concise rule name, usually "<Target> Limit" (e.g., "YouTube Limit", "Social Media Limit").'
          },
          targets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['url', 'group'],
                  description: 'Use "url" for one explicit site. Use "group" for a category or named group.'
                },
                value: {
                  type: 'string',
                  description: 'Bare domain for url targets (e.g., "youtube.com") or exact group name for group targets (e.g., "Social Media").'
                }
              },
              required: ['type', 'value']
            },
            description: 'Array of targets. Prefer one group target for category rules.'
          },
          ruleType: {
            type: 'string',
            enum: ['hard', 'soft', 'session'],
            description: '"hard" blocks after time expires, "soft" allows plus-one extensions, and "session" asks for a time on each visit.'
          },
          timeLimit: {
            type: 'number',
            description: 'Allowed time in minutes. Required for hard and soft rules. Omit for session rules.'
          },
          plusOnes: {
            type: 'number',
            description: 'Number of extensions allowed. Use only for soft rules. Omit for hard and session rules.'
          },
          plusOneDuration: {
            type: 'number',
            description: 'Duration of each soft-rule extension in seconds. Five minutes is 300 seconds. Omit for hard and session rules.'
          }
        },
        required: ['targets', 'ruleType']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_rule',
      description: 'Updates an existing rule after get_groups_and_rules returns it. Use this instead of creating a duplicate when the user changes type, time, extensions, or individual URL exceptions.',
      parameters: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'Exact existing rule name when available; otherwise the existing group or URL it targets.'
          },
          ruleType: {
            type: 'string',
            enum: ['hard', 'soft', 'session'],
            description: 'New rule type (optional - only include if changing)'
          },
          timeLimit: {
            type: 'number',
            description: 'New time rule in minutes (optional - only include if changing)'
          },
          plusOnes: {
            type: 'number',
            description: 'New number of extensions (optional - only for soft rules)'
          },
          plusOneDuration: {
            type: 'number',
            description: 'New duration of each extension in seconds (optional - only for soft rules)'
          },
          addUrls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bare lowercase domains to add as individual URL exceptions. Cannot add groups here.'
          },
          removeUrls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bare lowercase domains to remove from individual URL exceptions.'
          }
        },
        required: ['identifier']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_group',
      description: 'Updates an existing group after get_groups_and_rules returns it. Use this for renaming a group or changing the group URL list.',
      parameters: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'The name of the group to update (e.g., "Social Media")'
          },
          name: {
            type: 'string',
            description: 'New name for the group (optional - only include if renaming)'
          },
          addUrls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bare lowercase domains to add to the group.'
          },
          removeUrls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bare lowercase domains to remove from the group.'
          }
        },
        required: ['identifier']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_group',
      description: 'Deletes an existing group after get_groups_and_rules returns it and the user explicitly asks to delete the group.',
      parameters: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'The name of the group to delete (e.g., "Social Media")'
          }
        },
        required: ['identifier']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_rule',
      description: 'Deletes an existing rule after get_groups_and_rules returns it and the user explicitly asks to delete the rule.',
      parameters: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'The name of the rule, or the name of the group/URL it targets'
          }
        },
        required: ['identifier']
      }
    }
  }
];

/**
 * LLM Panel component that provides a chat interface using OpenAI API.
 * Displays at the bottom of the screen in a resizable panel.
 * Supports function calling to create groups and rules.
 */
const LLMPanel: React.FC<LLMPanelProps> = ({
  user,
  onCollapse,
  tutorialExpectedPrompt,
  onTutorialPromptAccepted,
  onTutorialPromptMismatch,
  onAiChatFocus,
  onAiChatBlur,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load conversation history on mount
  useEffect(() => {
    const loadConversationHistory = async () => {
      if (!user?.uid) return;

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const data = userDoc.data();
          const savedMessages = data.conversationHistory || [];

          // Parse the saved messages (they're stored as plain objects)
          const parsedMessages: Message[] = (savedMessages as PersistedMessage[]).flatMap(msg => {
            if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'tool') {
              return [];
            }

            return [{
              role: msg.role,
              content: typeof msg.content === 'string' ? msg.content : '',
              toolName: typeof msg.toolName === 'string' ? msg.toolName : undefined,
              toolArgs: msg.toolArgs,
              openAiMessage: msg.openAiMessage,
            }];
          });

          setMessages(parsedMessages);
        }
      } catch (error) {
        console.error('Error loading conversation history:', error);
      }
    };

    loadConversationHistory();
  }, [user?.uid]);

  // Save conversation history whenever messages change
  useEffect(() => {
    const saveConversationHistory = async () => {
      if (!user?.uid || messages.length === 0) return;

      try {
        // Clean messages: remove undefined fields before saving to Firestore
        const cleanedMessages = messages.map(msg => {
          const cleaned: Pick<Message, 'role' | 'content'> & Partial<Message> = {
            role: msg.role,
            content: msg.content || ''
          };

          if (msg.toolName !== undefined) cleaned.toolName = msg.toolName;
          if (msg.toolArgs !== undefined) cleaned.toolArgs = msg.toolArgs;
          if (msg.openAiMessage !== undefined) cleaned.openAiMessage = msg.openAiMessage;

          return cleaned;
        });

        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, { conversationHistory: cleanedMessages }, { merge: true });
      } catch (error) {
        console.error('Error saving conversation history:', error);
      }
    };

    // Debounce to avoid too many writes
    const timeoutId = setTimeout(saveConversationHistory, 500);
    return () => clearTimeout(timeoutId);
  }, [messages, user?.uid]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Group tool messages with the assistant response that follows them
  const groupedMessages = useMemo(() => {
    const result: Array<{
      role: 'user' | 'assistant';
      content: string;
      toolCalls?: ToolCallDisplay[];
    }> = [];

    let pendingToolCalls: ToolCallDisplay[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'tool' && msg.toolName) {
        // Collect tool calls
        pendingToolCalls.push({
          name: msg.toolName,
          args: msg.toolArgs,
          result: msg.content
        });
      } else if (msg.role === 'assistant' && msg.content) {
        // Assistant message - attach any pending tool calls
        result.push({
          role: 'assistant',
          content: msg.content,
          toolCalls: pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined
        });
        pendingToolCalls = [];
      } else if (msg.role === 'user') {
        result.push({
          role: 'user',
          content: msg.content
        });
      }
    }

    return result;
  }, [messages]);

  // Tool execution: Get Groups and Rules
  const executeGetGroupsAndRules = async (): Promise<string> => {
    if (!user?.uid) {
      return 'Error: User not authenticated';
    }

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        return 'No groups or rules found. The user has not created any yet.';
      }

      const data = userDoc.data();
      const groups: Group[] = data.groups || [];
      const rules: Rule[] = data.rules || [];

      if (groups.length === 0 && rules.length === 0) {
        return 'No groups or rules found. The user has not created any yet.';
      }

      let result = '';

      // Format groups
      if (groups.length > 0) {
        result += '**GROUPS:**\n';
        groups.forEach((group, index) => {
          const urls = group.items.map(url => formatUrlForDisplay(url)).join(', ');
          result += `${index + 1}. ${group.name}: ${urls}\n`;
        });
        result += '\n';
      }

      // Format rules
      if (rules.length > 0) {
        result += '**RULES:**\n';
        rules.forEach((rule, index) => {
          const name = rule.name || 'Unnamed rule';
          const type = rule.type;
          const time = rule.timeLimit;

          // Get target names
          const targetNames: string[] = [];
          rule.targets.forEach(target => {
            if (target.type === 'url') {
              targetNames.push(formatUrlForDisplay(target.id));
            } else {
              const group = groups.find(g => g.id === target.id);
              if (group) {
                targetNames.push(`[Group: ${group.name}]`);
              }
            }
          });

          const targetsStr = targetNames.join(', ');

          let ruleDetails = '';
          if (type === 'session') {
            ruleDetails = 'session-based (prompts on visit)';
          } else if (type === 'soft') {
            ruleDetails = `${time} minutes, ${rule.plusOnes} extensions of ${rule.plusOneDuration}s each`;
          } else {
            ruleDetails = `${time} minutes (hard block)`;
          }

          result += `${index + 1}. ${name} - ${type} rule on ${targetsStr}: ${ruleDetails}\n`;
        });
      }

      return result.trim();
    } catch (error) {
      console.error('Error getting groups and rules:', error);
      return `Error retrieving data: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  };

  // Tool execution: Create Group
  const executeCreateGroup = async (name: string, urls: string[]): Promise<string> => {
    if (!user?.uid) {
      return 'Error: User not authenticated';
    }

    try {
      // Normalize URLs
      const normalizedUrls = urls.map(url => {
        const prepared = url.startsWith('http') ? url : `https://${url}`;
        return normalizeUrl(prepared);
      });

      // Fetch existing groups
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);
      const existingGroups: Group[] = userDoc.exists() ? (userDoc.data().groups || []) : [];

      // Create new group
      const newGroup: Group = {
        id: `group:${Date.now()}`,
        name,
        items: normalizedUrls,
        createdAt: new Date().toISOString(),
      };

      // Save to Firestore
      const updatedGroups = [...existingGroups, newGroup];
      await setDoc(userDocRef, { groups: updatedGroups }, { merge: true });
      // Sync to chrome.storage for content script access
      await syncRulesToStorage(user.uid);

      return `Successfully created group "${name}" with ${urls.length} URL(s): ${urls.join(', ')}`;
    } catch (error) {
      console.error('Error creating group:', error);
      return `Error creating group: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  };

  // Tool execution: Update Group
  const executeUpdateGroup = async (
    identifier: string,
    name?: string,
    addUrls?: string[],
    removeUrls?: string[]
  ): Promise<string> => {
    console.log('executeUpdateGroup called with:', { identifier, name, addUrls, removeUrls });

    if (!user?.uid) {
      return 'Error: User not authenticated';
    }

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        return 'Error: User document not found';
      }

      const existingGroups: Group[] = userDoc.data().groups || [];

      // Find the group to update by name
      const groupToUpdate = existingGroups.find(group =>
        group.name.toLowerCase().includes(identifier.toLowerCase())
      );

      if (!groupToUpdate) {
        return `Error: Could not find a group matching "${identifier}". Available groups: ${existingGroups.map(g => g.name).join(', ')}`;
      }

      // Update the group
      const updatedGroup: Group = { ...groupToUpdate };

      // Update name if provided
      if (name !== undefined) {
        updatedGroup.name = name;
      }

      // Add URLs if provided
      if (addUrls && addUrls.length > 0) {
        const normalizedAddUrls = addUrls.map(url => {
          const prepared = url.startsWith('http') ? url : `https://${url}`;
          return normalizeUrl(prepared);
        });

        // Only add URLs that aren't already in the group
        normalizedAddUrls.forEach(url => {
          if (!updatedGroup.items.includes(url)) {
            updatedGroup.items.push(url);
          }
        });
      }

      // Remove URLs if provided
      if (removeUrls && removeUrls.length > 0) {
        const normalizedRemoveUrls = removeUrls.map(url => {
          const prepared = url.startsWith('http') ? url : `https://${url}`;
          return normalizeUrl(prepared);
        });

        updatedGroup.items = updatedGroup.items.filter(
          item => !normalizedRemoveUrls.includes(item)
        );
      }

      console.log('Updated group:', updatedGroup);

      // Save to Firestore
      const updatedGroups = existingGroups.map(g => g.id === updatedGroup.id ? updatedGroup : g);
      await setDoc(userDocRef, { groups: updatedGroups }, { merge: true });
      // Sync to chrome.storage for content script access
      await syncRulesToStorage(user.uid);

      let message = `Successfully updated group "${groupToUpdate.name}"`;
      const changes: string[] = [];

      if (name !== undefined) {
        changes.push(`renamed to "${name}"`);
      }
      if (addUrls && addUrls.length > 0) {
        changes.push(`added ${addUrls.length} URL(s): ${addUrls.join(', ')}`);
      }
      if (removeUrls && removeUrls.length > 0) {
        changes.push(`removed ${removeUrls.length} URL(s): ${removeUrls.join(', ')}`);
      }

      if (changes.length > 0) {
        message += ` (${changes.join('; ')})`;
      }

      return message;
    } catch (error) {
      console.error('Error updating group:', error);
      return `Error updating group: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  };

  // Tool execution: Update Rule
  const executeUpdateRule = async (
    identifier: string,
    ruleType?: 'hard' | 'soft' | 'session',
    timeLimit?: number,
    plusOnes?: number,
    plusOneDuration?: number,
    addUrls?: string[],
    removeUrls?: string[]
  ): Promise<string> => {
    console.log('executeUpdateRule called with:', { identifier, ruleType, timeLimit, plusOnes, plusOneDuration, addUrls, removeUrls });

    if (!user?.uid) {
      return 'Error: User not authenticated';
    }

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        return 'Error: User document not found';
      }

      const existingRules: Rule[] = userDoc.data().rules || [];
      const groups: Group[] = userDoc.data().groups || [];

      // Find the rule to update
      // Try matching by: 1) rule name, 2) group name in targets, 3) URL in targets
      const ruleToUpdate = existingRules.find(rule => {
        // Match by rule name
        if (rule.name && rule.name.toLowerCase().includes(identifier.toLowerCase())) {
          return true;
        }

        // Match by group name in targets
        for (const target of rule.targets) {
          if (target.type === 'group') {
            const group = groups.find(g => g.id === target.id);
            if (group && group.name.toLowerCase().includes(identifier.toLowerCase())) {
              return true;
            }
          } else if (target.type === 'url') {
            // Match by URL
            if (target.id.toLowerCase().includes(identifier.toLowerCase())) {
              return true;
            }
          }
        }

        return false;
      });

      if (!ruleToUpdate) {
        return `Error: Could not find a rule matching "${identifier}". Available rules: ${existingRules.map(l => l.name || 'Unnamed').join(', ')}`;
      }

      // Update the rule
      const updatedRule: Rule = { ...ruleToUpdate };

      if (ruleType !== undefined) {
        updatedRule.type = ruleType;

        // If changing to soft, ensure we have plusOnes and plusOneDuration
        if (ruleType === 'soft') {
          updatedRule.plusOnes = plusOnes !== undefined ? plusOnes : (updatedRule.plusOnes || 3);
          updatedRule.plusOneDuration = plusOneDuration !== undefined ? plusOneDuration : (updatedRule.plusOneDuration || 300);
        } else {
          // If not soft, remove plusOnes and plusOneDuration
          delete updatedRule.plusOnes;
          delete updatedRule.plusOneDuration;
        }
      }

      if (timeLimit !== undefined) {
        updatedRule.timeLimit = timeLimit;
      }

      if (ruleType === 'soft' || updatedRule.type === 'soft') {
        if (plusOnes !== undefined) {
          updatedRule.plusOnes = plusOnes;
        }
        if (plusOneDuration !== undefined) {
          updatedRule.plusOneDuration = plusOneDuration;
        }
      }

      // Handle adding URLs
      if (addUrls && addUrls.length > 0) {
        const normalizedAddUrls = addUrls.map(url => {
          const prepared = url.startsWith('http') ? url : `https://${url}`;
          return normalizeUrl(prepared);
        });

        normalizedAddUrls.forEach(url => {
          // Check if URL already exists in targets
          const urlExists = updatedRule.targets.some(t => t.type === 'url' && t.id === url);
          if (!urlExists) {
            updatedRule.targets.push({ type: 'url', id: url });
          }
        });
      }

      // Handle removing URLs
      if (removeUrls && removeUrls.length > 0) {
        const normalizedRemoveUrls = removeUrls.map(url => {
          const prepared = url.startsWith('http') ? url : `https://${url}`;
          return normalizeUrl(prepared);
        });

        updatedRule.targets = updatedRule.targets.filter(
          t => !(t.type === 'url' && normalizedRemoveUrls.includes(t.id))
        );
      }

      console.log('Updated rule:', updatedRule);

      // Save to Firestore
      const updatedRules = existingRules.map(l => l.id === updatedRule.id ? updatedRule : l);
      await setDoc(userDocRef, { rules: updatedRules }, { merge: true });
      // Sync to chrome.storage for content script access
      await syncRulesToStorage(user.uid);

      const changes: string[] = [];
      if (ruleType !== undefined) {
        changes.push(`type changed to ${ruleType}`);
      }
      if (timeLimit !== undefined) {
        changes.push(`time rule changed to ${timeLimit} minutes`);
      }
      if (addUrls && addUrls.length > 0) {
        changes.push(`added ${addUrls.length} URL(s): ${addUrls.join(', ')}`);
      }
      if (removeUrls && removeUrls.length > 0) {
        changes.push(`removed ${removeUrls.length} URL(s): ${removeUrls.join(', ')}`);
      }

      const ruleName = updatedRule.name || 'rule';
      const changesSummary = changes.length > 0 ? ` (${changes.join('; ')})` : '';

      return `Successfully updated ${ruleName}${changesSummary}`;
    } catch (error) {
      console.error('Error updating rule:', error);
      return `Error updating rule: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  };

  // Tool execution: Delete Group
  const executeDeleteGroup = async (identifier: string): Promise<string> => {
    console.log('executeDeleteGroup called with:', { identifier });

    if (!user?.uid) {
      return 'Error: User not authenticated';
    }

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        return 'Error: User document not found';
      }

      const existingGroups: Group[] = userDoc.data().groups || [];

      // Find the group to delete by name
      const groupToDelete = existingGroups.find(group =>
        group.name.toLowerCase().includes(identifier.toLowerCase())
      );

      if (!groupToDelete) {
        return `Error: Could not find a group matching "${identifier}". Available groups: ${existingGroups.map(g => g.name).join(', ')}`;
      }

      // Remove the group
      const updatedGroups = existingGroups.filter(g => g.id !== groupToDelete.id);
      await setDoc(userDocRef, { groups: updatedGroups }, { merge: true });
      // Sync to chrome.storage for content script access
      await syncRulesToStorage(user.uid);

      return `Successfully deleted group "${groupToDelete.name}"`;
    } catch (error) {
      console.error('Error deleting group:', error);
      return `Error deleting group: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  };

  // Tool execution: Delete Rule
  const executeDeleteRule = async (identifier: string): Promise<string> => {
    console.log('executeDeleteRule called with:', { identifier });

    if (!user?.uid) {
      return 'Error: User not authenticated';
    }

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        return 'Error: User document not found';
      }

      const existingRules: Rule[] = userDoc.data().rules || [];
      const groups: Group[] = userDoc.data().groups || [];

      // Find the rule to delete (same matching logic as update)
      const ruleToDelete = existingRules.find(rule => {
        // Match by rule name
        if (rule.name && rule.name.toLowerCase().includes(identifier.toLowerCase())) {
          return true;
        }

        // Match by group name in targets
        for (const target of rule.targets) {
          if (target.type === 'group') {
            const group = groups.find(g => g.id === target.id);
            if (group && group.name.toLowerCase().includes(identifier.toLowerCase())) {
              return true;
            }
          } else if (target.type === 'url') {
            // Match by URL
            if (target.id.toLowerCase().includes(identifier.toLowerCase())) {
              return true;
            }
          }
        }

        return false;
      });

      if (!ruleToDelete) {
        return `Error: Could not find a rule matching "${identifier}". Available rules: ${existingRules.map(l => l.name || 'Unnamed').join(', ')}`;
      }

      // Remove the rule
      const updatedRules = existingRules.filter(l => l.id !== ruleToDelete.id);
      await setDoc(userDocRef, { rules: updatedRules }, { merge: true });
      // Sync to chrome.storage for content script access
      await syncRulesToStorage(user.uid);

      const ruleName = ruleToDelete.name || 'rule';
      return `Successfully deleted ${ruleName}`;
    } catch (error) {
      console.error('Error deleting rule:', error);
      return `Error deleting rule: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  };

  // Tool execution: Create Rule
  const executeCreateRule = async (
    name: string | undefined,
    targets: Array<{ type: 'url' | 'group'; value: string }>,
    ruleType: 'hard' | 'soft' | 'session',
    timeLimit: number | undefined,
    plusOnes: number | undefined,
    plusOneDuration: number | undefined
  ): Promise<string> => {
    console.log('executeCreateRule called with:', { name, targets, ruleType, timeLimit, plusOnes, plusOneDuration });

    if (!user?.uid) {
      return 'Error: User not authenticated';
    }

    try {
      // Fetch existing groups and rules
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        return 'Error: User document not found';
      }

      const existingRules: Rule[] = userDoc.data().rules || [];
      const groups: Group[] = userDoc.data().groups || [];

      console.log('Available groups:', groups.map(g => ({ id: g.id, name: g.name })));

      // Process targets
      const ruleTargets: RuleTarget[] = [];

      for (const target of targets) {
        console.log('Processing target:', target);

        if (target.type === 'url') {
          const prepared = target.value.startsWith('http') ? target.value : `https://${target.value}`;
          const normalizedUrl = normalizeUrl(prepared);
          ruleTargets.push({ type: 'url', id: normalizedUrl });
          console.log('Added URL target:', normalizedUrl);
        } else {
          // Find group by name
          const group = groups.find(g => g.name.toLowerCase() === target.value.toLowerCase());
          console.log(`Looking for group "${target.value}", found:`, group);

          if (!group) {
            const availableGroups = groups.map(g => g.name).join(', ');
            return `Error: Group "${target.value}" not found. Available groups: ${availableGroups || 'none'}`;
          }
          ruleTargets.push({ type: 'group', id: group.id });
          console.log('Added group target:', group.name);
        }
      }

      if (ruleTargets.length === 0) {
        return 'Error: No valid targets specified';
      }

      // Create new rule
      const newRule: Rule = {
        id: `rule:${Date.now()}`,
        type: ruleType,
        targets: ruleTargets,
        timeLimit: timeLimit || 0,
        createdAt: new Date().toISOString(),
      };

      if (name) {
        newRule.name = name;
      }

      if (ruleType === 'soft' && plusOnes !== undefined && plusOneDuration !== undefined) {
        newRule.plusOnes = plusOnes;
        newRule.plusOneDuration = plusOneDuration;
      }

      console.log('Creating rule:', newRule);

      // Save to Firestore
      const updatedRules = [...existingRules, newRule];
      await setDoc(userDocRef, { rules: updatedRules }, { merge: true });
      // Sync to chrome.storage for content script access
      await syncRulesToStorage(user.uid);

      const targetNames = targets.map(t => t.value).join(', ');
      const ruleDetails = ruleType === 'session'
        ? 'session-based (prompts on visit)'
        : ruleType === 'soft'
        ? `${timeLimit} minutes with ${plusOnes} extensions of ${plusOneDuration}s each`
        : `${timeLimit} minutes (hard block)`;

      return `Successfully created ${ruleType} rule${name ? ` "${name}"` : ''} on: ${targetNames}. Rule: ${ruleDetails}`;
    } catch (error) {
      console.error('Error creating rule:', error);
      return `Error creating rule: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  };

  const ensureTutorialSocialRule = async (): Promise<string> => {
    if (!user?.uid) {
      throw new Error('Please sign in to use the AI assistant.');
    }

    const userDocRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userDocRef);
    const data = userDoc.exists() ? userDoc.data() : {};
    const existingGroups: Group[] = data.groups || [];
    const existingRules: Rule[] = data.rules || [];
    const normalizedSocialUrls = TUTORIAL_SOCIAL_URLS.map(url => normalizeUrl(`https://${url}`));

    let groups = [...existingGroups];
    let socialGroup = groups.find(group => group.name.toLowerCase() === TUTORIAL_GROUP_NAME.toLowerCase());

    if (!socialGroup) {
      socialGroup = {
        id: `group:${Date.now()}`,
        name: TUTORIAL_GROUP_NAME,
        items: normalizedSocialUrls,
        createdAt: new Date().toISOString(),
      };
      groups = [...groups, socialGroup];
    } else {
      const nextItems = [...socialGroup.items];
      normalizedSocialUrls.forEach(url => {
        if (!nextItems.includes(url)) {
          nextItems.push(url);
        }
      });

      socialGroup = {
        ...socialGroup,
        items: nextItems,
      };
      groups = groups.map(group => group.id === socialGroup?.id ? socialGroup : group);
    }

    const tutorialRuleIndex = existingRules.findIndex(rule => {
      if (rule.name === TUTORIAL_RULE_NAME) return true;

      return rule.targets?.some(target => target.type === 'group' && target.id === socialGroup?.id) ?? false;
    });

    const existingTutorialRule = tutorialRuleIndex >= 0 ? existingRules[tutorialRuleIndex] : null;
    const tutorialRule: Rule = {
      id: existingTutorialRule?.id || `rule:${Date.now() + 1}`,
      createdAt: existingTutorialRule?.createdAt || new Date().toISOString(),
      name: TUTORIAL_RULE_NAME,
      type: 'hard',
      targets: [{ type: 'group', id: socialGroup.id }],
      timeLimit: 20,
    };

    const rules = tutorialRuleIndex >= 0
      ? existingRules.map((rule, index) => index === tutorialRuleIndex ? tutorialRule : rule)
      : [...existingRules, tutorialRule];

    await setDoc(userDocRef, { groups, rules }, { merge: true });
    await syncRulesToStorage(user.uid);
    window.dispatchEvent(new CustomEvent('groupsOrRulesUpdated'));

    return `Created ${TUTORIAL_RULE_NAME}: 20-minute daily hard limit for ${TUTORIAL_GROUP_NAME}.`;
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    if (!user?.uid) {
      setError('Please sign in to use the AI assistant.');
      return;
    }

    const userMessageContent = input.trim();

    if (tutorialExpectedPrompt && userMessageContent !== tutorialExpectedPrompt) {
      setError('For the tutorial, type the prompt exactly as shown.');
      onTutorialPromptMismatch?.(true);
      return;
    }

    if (tutorialExpectedPrompt) {
      const userMessage: Message = {
        role: 'user',
        content: userMessageContent,
        openAiMessage: { role: 'user', content: userMessageContent }
      };

      setMessages(prev => [...prev, userMessage]);
      setInput('');
      setLoading(true);
      setStreamingContent('');
      setError(null);
      onTutorialPromptMismatch?.(false);

      try {
        const result = await ensureTutorialSocialRule();
        const assistantMessage: Message = {
          role: 'assistant',
          content: `${result} Open it from the Rules list and make it Soft with five one-minute extensions.`,
          openAiMessage: {
            role: 'assistant',
            content: `${result} Open it from the Rules list and make it Soft with five one-minute extensions.`
          }
        };

        setMessages(prev => [...prev, assistantMessage]);
        onTutorialPromptAccepted?.();
      } catch (err) {
        setError(err instanceof Error ? `Error: ${err.message}` : 'An unexpected error occurred. Please try again.');
      } finally {
        setLoading(false);
      }

      return;
    }

    const userMessage: Message = {
      role: 'user',
      content: userMessageContent,
      openAiMessage: { role: 'user', content: userMessageContent }
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setStreamingContent('');
    setError(null);

    // Declare conversationMessages outside try block so it's accessible for error debugging
    let conversationMessages: ChatCompletionMessageParam[] = [];

    try {
      conversationMessages = [
        {
          role: 'system',
          content: AI_CHAT_SYSTEM_PROMPT
        },
        // Build conversation from stored OpenAI messages
        ...messages
          .filter(m => m.openAiMessage) // Only include messages with proper OpenAI format
          .map(m => m.openAiMessage!),
        { role: 'user', content: userMessageContent }
      ];

      const requestCompletion = async (
        requestMessages: ChatCompletionMessageParam[],
        includeTools: boolean
      ) => createOpenAIChatCompletion(user.uid, {
        messages: requestMessages,
        tools: includeTools ? tools : undefined,
        tool_choice: includeTools ? 'auto' : undefined,
        temperature: 0,
      });

      // First API call - may return tool calls
      const initialResponse = await requestCompletion(conversationMessages, true);

      const responseMessage = initialResponse.choices[0]?.message;

      if (!responseMessage) {
        throw new Error('No response from API');
      }

      // Loop to handle multiple rounds of tool calls (for chain-of-thought)
      let currentResponse: AssistantChatCompletionMessage = responseMessage;
      const maxRounds = 10; // Prevent infinite loops
      let round = 0;

      while (currentResponse.tool_calls && currentResponse.tool_calls.length > 0 && round < maxRounds) {
        round++;

        // Store the assistant's message with tool calls in history (for ALL rounds)
        // This ensures tool result messages have a corresponding assistant message with tool_calls
        const assistantWithToolsMessage: Message = {
          role: 'assistant',
          content: currentResponse.content || '',
          openAiMessage: currentResponse
        };
        setMessages(prev => [...prev, assistantWithToolsMessage]);

        // Add the assistant's message with tool calls to conversation
        conversationMessages.push(currentResponse);

        // Execute each tool call
        for (const toolCall of currentResponse.tool_calls) {
          let toolResult: string;

          // Type guard to ensure it's a function tool call
          if (toolCall.type !== 'function' || !toolCall.function) {
            continue;
          }

          try {
            const args = JSON.parse(toolCall.function.arguments);

            // Show tool call in the UI (display message only)
            const toolCallMessage: Message = {
              role: 'tool',
              content: '',
              toolName: toolCall.function.name,
              toolArgs: args,
              // Don't store openAiMessage for display-only tool messages
            };
            setMessages(prev => [...prev, toolCallMessage]);

            if (toolCall.function.name === 'get_groups_and_rules') {
              toolResult = await executeGetGroupsAndRules();
            } else if (toolCall.function.name === 'create_group') {
              toolResult = await executeCreateGroup(args.name, args.urls);
            } else if (toolCall.function.name === 'update_group') {
              toolResult = await executeUpdateGroup(
                args.identifier,
                args.name,
                args.addUrls,
                args.removeUrls
              );
            } else if (toolCall.function.name === 'create_rule') {
              toolResult = await executeCreateRule(
                args.name,
                args.targets,
                args.ruleType,
                args.timeLimit,
                args.plusOnes,
                args.plusOneDuration
              );
            } else if (toolCall.function.name === 'update_rule') {
              toolResult = await executeUpdateRule(
                args.identifier,
                args.ruleType,
                args.timeLimit,
                args.plusOnes,
                args.plusOneDuration,
                args.addUrls,
                args.removeUrls
              );
            } else if (toolCall.function.name === 'delete_group') {
              toolResult = await executeDeleteGroup(args.identifier);
            } else if (toolCall.function.name === 'delete_rule') {
              toolResult = await executeDeleteRule(args.identifier);
            } else {
              toolResult = `Error: Unknown tool ${toolCall.function.name}`;
            }

            // Dispatch event to refresh Groups/Rules tabs if the tool call was successful
            if (!toolResult.startsWith('Error:')) {
              const dataModifyingTools = ['create_group', 'update_group', 'delete_group', 'create_rule', 'update_rule', 'delete_rule'];
              if (dataModifyingTools.includes(toolCall.function.name)) {
                console.log(`Dispatching groupsOrRulesUpdated event for tool: ${toolCall.function.name}`);
                window.dispatchEvent(new CustomEvent('groupsOrRulesUpdated'));
              }
            }

            // Update the tool call message with the result (display only)
            setMessages(prev => prev.map((msg, idx) =>
              idx === prev.length - 1 && msg.role === 'tool'
                ? { ...msg, content: toolResult }
                : msg
            ));
          } catch (error) {
            toolResult = `Error executing tool: ${error instanceof Error ? error.message : 'Unknown error'}`;

            // Update with error (display only)
            setMessages(prev => prev.map((msg, idx) =>
              idx === prev.length - 1 && msg.role === 'tool'
                ? { ...msg, content: toolResult }
                : msg
            ));
          }

          // Add tool result to conversation (for OpenAI API)
          const toolResultMessage: ChatCompletionToolMessageParam = {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult
          };
          conversationMessages.push(toolResultMessage);

          // Store tool result in messages for future context (hidden from UI display)
          const toolResultStorageMessage: Message = {
            role: 'assistant',
            content: '', // Empty content so it doesn't show in UI
            openAiMessage: toolResultMessage
          };
          setMessages(prev => [...prev, toolResultStorageMessage]);
        }

        // Make another API call to check if more tools are needed
        const nextResponse = await requestCompletion(conversationMessages, true);

        currentResponse = nextResponse.choices[0]?.message;

        if (!currentResponse) {
          throw new Error('No response from API');
        }
      }

      // Now stream the final response (either no tool calls or we hit max rounds)
      if (currentResponse.tool_calls && currentResponse.tool_calls.length > 0) {
        // Hit max rounds, just show what we have
        const assistantMessage: Message = {
          role: 'assistant',
          content: currentResponse.content || 'Tool execution completed.',
          openAiMessage: currentResponse
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else if (currentResponse.content) {
        // No more tool calls, show the content directly
        const assistantMessage: Message = {
          role: 'assistant',
          content: currentResponse.content,
          openAiMessage: currentResponse
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        conversationMessages.push(currentResponse);
        const finalResponse = await requestCompletion(conversationMessages, false);
        const finalResponseMessage = finalResponse.choices[0]?.message;
        const finalContent = finalResponseMessage?.content || 'Done.';
        const assistantMessage: Message = {
          role: 'assistant',
          content: finalContent,
          openAiMessage: finalResponseMessage || { role: 'assistant', content: finalContent }
        };

        setMessages(prev => [...prev, assistantMessage]);
        setStreamingContent('');
      }
    } catch (err) {
      console.error('OpenAI proxy error:', err);

      let userFriendlyMessage = 'An unexpected error occurred. Please try again.';

      if (err instanceof Error) {
        const errorMsg = err.message.toLowerCase();

        // Handle specific error patterns with user-friendly messages
        if (errorMsg.includes('tool') && errorMsg.includes('tool_calls')) {
          userFriendlyMessage = 'Internal conversation format error. Try clearing the chat with the trash icon and starting fresh.';
          console.error('Tool message format error - conversation history may be corrupted');
          console.error('=== DEBUG: Conversation that caused the error ===');
          console.error('Full messages array:', messages);
          console.error('Messages with openAiMessage field:', messages.filter(m => m.openAiMessage).map(m => m.openAiMessage));
          console.error('conversationMessages sent to API:', conversationMessages);
          console.error('=== END DEBUG ===');
        } else if (errorMsg.includes('authentication expired') || errorMsg.includes('unauthorized') || errorMsg.includes('401')) {
          userFriendlyMessage = 'Your session expired. Please sign out and sign back in.';
        } else if (
          errorMsg.includes('proxy is not configured') ||
          errorMsg.includes('openai_api_key') ||
          errorMsg.includes('openai_chat_model')
        ) {
          userFriendlyMessage = 'The AI backend is not configured yet. Set OPENAI_API_KEY and OPENAI_CHAT_MODEL for Firebase Functions, then redeploy the web project.';
        } else if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
          userFriendlyMessage = 'API rate limit exceeded. Please wait a moment and try again.';
        } else if (errorMsg.includes('quota') || errorMsg.includes('billing')) {
          userFriendlyMessage = 'API quota exceeded. Please check your OpenAI account billing.';
        } else if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
          userFriendlyMessage = 'Request timed out. Please check your internet connection and try again.';
        } else if (errorMsg.includes('network') || errorMsg.includes('fetch')) {
          userFriendlyMessage = 'Network error. Please check your internet connection.';
        } else if (errorMsg.includes('400')) {
          userFriendlyMessage = `Invalid request: ${err.message}. Try clearing the chat if the issue persists.`;
        } else {
          // For other errors, show the actual message but make it clearer
          userFriendlyMessage = `Error: ${err.message}`;
        }
      }

      setError(userFriendlyMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = async () => {
    setMessages([]);
    setError(null);
    setStreamingContent('');

    // Clear from database
    if (user?.uid) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, { conversationHistory: [] }, { merge: true });
      } catch (error) {
        console.error('Error clearing conversation history:', error);
      }
    }
  };

  // Collapsible tool call component
  const ToolCallsDisplay: React.FC<{
    toolCalls: ToolCallDisplay[];
  }> = ({ toolCalls }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
      <div className="mt-2 border-t border-zinc-600 pt-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          <span className="font-medium">
            {toolCalls.length} tool call{toolCalls.length > 1 ? 's' : ''} used
          </span>
        </button>

        {isExpanded && (
          <div className="mt-2 space-y-2">
            {toolCalls.map((tool, idx) => (
              <div
                key={idx}
                className="bg-zinc-900/50 border border-zinc-600 rounded px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-purple-400 text-xs font-semibold">🔧</span>
                  <span className="text-purple-300 text-xs font-medium">{tool.name}</span>
                </div>
                {tool.args !== undefined && (
                  <div className="text-xs text-zinc-400 mb-1.5 font-mono bg-zinc-900 rounded px-1.5 py-1 overflow-x-auto">
                    {JSON.stringify(tool.args, null, 2)}
                  </div>
                )}
                {tool.result && (
                  <div className="text-xs text-zinc-300 bg-zinc-900 rounded px-1.5 py-1">
                    <span className="text-zinc-500">→ </span>
                    {tool.result}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-t border-zinc-700">
      {/* Header */}
      <div className="px-4 py-2 border-b border-zinc-700 bg-zinc-800 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">AI Assistant</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={clearChat}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors"
            title="Clear chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors"
              title="Collapse AI Assistant"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {groupedMessages.length === 0 && (
          <div className="text-center text-zinc-500 text-sm mt-8">
            Start a conversation with the AI assistant
          </div>
        )}
        {groupedMessages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                message.role === 'user'
                  ? 'bg-zinc-700 text-white'
                  : 'bg-zinc-800 text-zinc-100 border border-zinc-700'
              }`}
            >
              {message.role === 'assistant' ? (
                <MarkdownMessage content={message.content} />
              ) : (
                <div className="whitespace-pre-wrap break-words">{message.content}</div>
              )}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <ToolCallsDisplay toolCalls={message.toolCalls} />
              )}
            </div>
          </div>
        ))}
        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
              <MarkdownMessage content={streamingContent} />
              <span className="inline-block w-2 h-4 ml-1 bg-zinc-500 animate-pulse" />
            </div>
          </div>
        )}
        {loading && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Thinking...</span>
            </div>
          </div>
        )}
        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-400 rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-700 bg-zinc-800">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (tutorialExpectedPrompt && e.target.value.trim() === tutorialExpectedPrompt) {
                onTutorialPromptMismatch?.(false);
                setError(null);
              }
            }}
            onFocus={onAiChatFocus}
            onBlur={onAiChatBlur}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            data-tutorial-target="ai-input"
            className="flex-1 bg-zinc-900 text-white border border-zinc-700 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-zinc-500"
            rows={2}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-zinc-700 text-white rounded-lg hover:bg-zinc-600 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors self-end"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LLMPanel;
