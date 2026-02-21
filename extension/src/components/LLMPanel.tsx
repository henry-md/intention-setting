import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Loader2, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import OpenAI from 'openai';
import type { User } from '../types/User';
import type { Group } from '../types/Group';
import type { Limit, LimitTarget } from '../types/Limit';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { normalizeUrl } from '../utils/urlNormalization';
import { syncLimitsToStorage } from '../utils/syncLimitsToStorage';

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolArgs?: any;
  // Store the actual OpenAI message format for proper conversation history
  openAiMessage?: OpenAI.Chat.Completions.ChatCompletionMessageParam;
}

interface LLMPanelProps {
  user: User | null;
  onCollapse?: () => void;
}

// Define OpenAI function tools
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_groups_and_limits',
      description: 'Retrieves all existing groups and limits. Use this to see what groups and limits are already configured before creating new ones or when the user asks about existing configurations.',
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
      description: 'Creates a new group of websites. Groups are collections of URLs that can be used in limits. When creating a group, provide a name and a list of website URLs.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name for the group (e.g., "Social Media", "Video Sites")'
          },
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of website URLs to include in the group (e.g., ["youtube.com", "instagram.com"]). Do not include https:// or www. - just the domain name.'
          }
        },
        required: ['name', 'urls']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_limit',
      description: 'Creates a time limit on websites or groups. Limits restrict how long you can spend on specified sites. There are three types: "hard" (strict blocking after time expires), "soft" (allows extensions/plus-ones), and "session" (prompts for time limit when visiting). You can specify groups by name or individual URLs.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Optional name for the limit'
          },
          targets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['url', 'group'],
                  description: 'Whether this target is a URL or a group name'
                },
                value: {
                  type: 'string',
                  description: 'The URL (e.g., "youtube.com") or group name (e.g., "Social Media")'
                }
              },
              required: ['type', 'value']
            },
            description: 'Array of targets (URLs or group names) to apply the limit to'
          },
          limitType: {
            type: 'string',
            enum: ['hard', 'soft', 'session'],
            description: 'Type of limit: "hard" (strict block), "soft" (allows extensions), or "session" (prompts on visit)'
          },
          timeLimit: {
            type: 'number',
            description: 'Time limit in minutes (not needed for session limits)'
          },
          plusOnes: {
            type: 'number',
            description: 'Number of time extensions allowed (only for soft limits). For ex. they can ask for 3 extensions of 5 minutes each. So they would get their allotted time, and be able to press a "one more" button 3 times for a total of 15 extra minutes on their sites.'
          },
          plusOneDuration: {
            type: 'number',
            description: 'Duration of each extension in seconds (only for soft limits)'
          }
        },
        required: ['targets', 'limitType']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_limit',
      description: 'Updates an existing limit. Use this to change the type, time, add/remove targets, or other properties of a limit. You can identify the limit by its name or by the group/URL it targets.',
      parameters: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'The name of the limit, or the name of the group/URL it targets (e.g., "Social Media Limit" or "Social Media")'
          },
          limitType: {
            type: 'string',
            enum: ['hard', 'soft', 'session'],
            description: 'New limit type (optional - only include if changing)'
          },
          timeLimit: {
            type: 'number',
            description: 'New time limit in minutes (optional - only include if changing)'
          },
          plusOnes: {
            type: 'number',
            description: 'New number of extensions (optional - only for soft limits)'
          },
          plusOneDuration: {
            type: 'number',
            description: 'New duration of each extension in seconds (optional - only for soft limits)'
          },
          addUrls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Spare URLs to add to the limit (optional - e.g., ["youtube.com", "reddit.com"]). Note: Cannot add/remove groups, only individual URLs.'
          },
          removeUrls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Spare URLs to remove from the limit (optional - e.g., ["facebook.com"])'
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
      description: 'Updates an existing group. Use this to rename a group or add/remove URLs from it. You can identify the group by its name.',
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
            description: 'URLs to add to the group (optional - e.g., ["reddit.com", "twitter.com"])'
          },
          removeUrls: {
            type: 'array',
            items: { type: 'string' },
            description: 'URLs to remove from the group (optional - e.g., ["facebook.com"])'
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
      description: 'Deletes an existing group. Use this when the user wants to remove a group entirely.',
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
      name: 'delete_limit',
      description: 'Deletes an existing limit. Use this when the user wants to remove a limit entirely.',
      parameters: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'The name of the limit, or the name of the group/URL it targets'
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
 * Supports function calling to create groups and limits.
 */
const LLMPanel: React.FC<LLMPanelProps> = ({ user, onCollapse }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

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
          const parsedMessages: Message[] = savedMessages.map((msg: any) => ({
            role: msg.role,
            content: msg.content,
            toolName: msg.toolName,
            toolArgs: msg.toolArgs,
            openAiMessage: msg.openAiMessage
          }));

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
          const cleaned: any = {
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
      toolCalls?: Array<{ name: string; args: any; result: string }>;
    }> = [];

    let pendingToolCalls: Array<{ name: string; args: any; result: string }> = [];

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

  // Tool execution: Get Groups and Limits
  const executeGetGroupsAndLimits = async (): Promise<string> => {
    if (!user?.uid) {
      return 'Error: User not authenticated';
    }

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        return 'No groups or limits found. The user has not created any yet.';
      }

      const data = userDoc.data();
      const groups: Group[] = data.groups || [];
      const limits: Limit[] = data.limits || [];

      if (groups.length === 0 && limits.length === 0) {
        return 'No groups or limits found. The user has not created any yet.';
      }

      let result = '';

      // Format groups
      if (groups.length > 0) {
        result += '**GROUPS:**\n';
        groups.forEach((group, index) => {
          const urls = group.items.map(url => url.replace(/^https?:\/\//, '')).join(', ');
          result += `${index + 1}. ${group.name}: ${urls}\n`;
        });
        result += '\n';
      }

      // Format limits
      if (limits.length > 0) {
        result += '**LIMITS:**\n';
        limits.forEach((limit, index) => {
          const name = limit.name || 'Unnamed limit';
          const type = limit.type;
          const time = limit.timeLimit;

          // Get target names
          const targetNames: string[] = [];
          limit.targets.forEach(target => {
            if (target.type === 'url') {
              targetNames.push(target.id.replace(/^https?:\/\//, ''));
            } else {
              const group = groups.find(g => g.id === target.id);
              if (group) {
                targetNames.push(`[Group: ${group.name}]`);
              }
            }
          });

          const targetsStr = targetNames.join(', ');

          let limitDetails = '';
          if (type === 'session') {
            limitDetails = 'session-based (prompts on visit)';
          } else if (type === 'soft') {
            limitDetails = `${time} minutes, ${limit.plusOnes} extensions of ${limit.plusOneDuration}s each`;
          } else {
            limitDetails = `${time} minutes (hard block)`;
          }

          result += `${index + 1}. ${name} - ${type} limit on ${targetsStr}: ${limitDetails}\n`;
        });
      }

      return result.trim();
    } catch (error) {
      console.error('Error getting groups and limits:', error);
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
      await syncLimitsToStorage(user.uid);

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
      await syncLimitsToStorage(user.uid);

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

  // Tool execution: Update Limit
  const executeUpdateLimit = async (
    identifier: string,
    limitType?: 'hard' | 'soft' | 'session',
    timeLimit?: number,
    plusOnes?: number,
    plusOneDuration?: number,
    addUrls?: string[],
    removeUrls?: string[]
  ): Promise<string> => {
    console.log('executeUpdateLimit called with:', { identifier, limitType, timeLimit, plusOnes, plusOneDuration, addUrls, removeUrls });

    if (!user?.uid) {
      return 'Error: User not authenticated';
    }

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        return 'Error: User document not found';
      }

      const existingLimits: Limit[] = userDoc.data().limits || [];
      const groups: Group[] = userDoc.data().groups || [];

      // Find the limit to update
      // Try matching by: 1) limit name, 2) group name in targets, 3) URL in targets
      const limitToUpdate = existingLimits.find(limit => {
        // Match by limit name
        if (limit.name && limit.name.toLowerCase().includes(identifier.toLowerCase())) {
          return true;
        }

        // Match by group name in targets
        for (const target of limit.targets) {
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

      if (!limitToUpdate) {
        return `Error: Could not find a limit matching "${identifier}". Available limits: ${existingLimits.map(l => l.name || 'Unnamed').join(', ')}`;
      }

      // Update the limit
      const updatedLimit: Limit = { ...limitToUpdate };

      if (limitType !== undefined) {
        updatedLimit.type = limitType;

        // If changing to soft, ensure we have plusOnes and plusOneDuration
        if (limitType === 'soft') {
          updatedLimit.plusOnes = plusOnes !== undefined ? plusOnes : (updatedLimit.plusOnes || 3);
          updatedLimit.plusOneDuration = plusOneDuration !== undefined ? plusOneDuration : (updatedLimit.plusOneDuration || 300);
        } else {
          // If not soft, remove plusOnes and plusOneDuration
          delete updatedLimit.plusOnes;
          delete updatedLimit.plusOneDuration;
        }
      }

      if (timeLimit !== undefined) {
        updatedLimit.timeLimit = timeLimit;
      }

      if (limitType === 'soft' || updatedLimit.type === 'soft') {
        if (plusOnes !== undefined) {
          updatedLimit.plusOnes = plusOnes;
        }
        if (plusOneDuration !== undefined) {
          updatedLimit.plusOneDuration = plusOneDuration;
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
          const urlExists = updatedLimit.targets.some(t => t.type === 'url' && t.id === url);
          if (!urlExists) {
            updatedLimit.targets.push({ type: 'url', id: url });
          }
        });
      }

      // Handle removing URLs
      if (removeUrls && removeUrls.length > 0) {
        const normalizedRemoveUrls = removeUrls.map(url => {
          const prepared = url.startsWith('http') ? url : `https://${url}`;
          return normalizeUrl(prepared);
        });

        updatedLimit.targets = updatedLimit.targets.filter(
          t => !(t.type === 'url' && normalizedRemoveUrls.includes(t.id))
        );
      }

      console.log('Updated limit:', updatedLimit);

      // Save to Firestore
      const updatedLimits = existingLimits.map(l => l.id === updatedLimit.id ? updatedLimit : l);
      await setDoc(userDocRef, { limits: updatedLimits }, { merge: true });
      // Sync to chrome.storage for content script access
      await syncLimitsToStorage(user.uid);

      const changes: string[] = [];
      if (limitType !== undefined) {
        changes.push(`type changed to ${limitType}`);
      }
      if (timeLimit !== undefined) {
        changes.push(`time limit changed to ${timeLimit} minutes`);
      }
      if (addUrls && addUrls.length > 0) {
        changes.push(`added ${addUrls.length} URL(s): ${addUrls.join(', ')}`);
      }
      if (removeUrls && removeUrls.length > 0) {
        changes.push(`removed ${removeUrls.length} URL(s): ${removeUrls.join(', ')}`);
      }

      const limitName = updatedLimit.name || 'limit';
      const changesSummary = changes.length > 0 ? ` (${changes.join('; ')})` : '';

      return `Successfully updated ${limitName}${changesSummary}`;
    } catch (error) {
      console.error('Error updating limit:', error);
      return `Error updating limit: ${error instanceof Error ? error.message : 'Unknown error'}`;
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
      await syncLimitsToStorage(user.uid);

      return `Successfully deleted group "${groupToDelete.name}"`;
    } catch (error) {
      console.error('Error deleting group:', error);
      return `Error deleting group: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  };

  // Tool execution: Delete Limit
  const executeDeleteLimit = async (identifier: string): Promise<string> => {
    console.log('executeDeleteLimit called with:', { identifier });

    if (!user?.uid) {
      return 'Error: User not authenticated';
    }

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        return 'Error: User document not found';
      }

      const existingLimits: Limit[] = userDoc.data().limits || [];
      const groups: Group[] = userDoc.data().groups || [];

      // Find the limit to delete (same matching logic as update)
      const limitToDelete = existingLimits.find(limit => {
        // Match by limit name
        if (limit.name && limit.name.toLowerCase().includes(identifier.toLowerCase())) {
          return true;
        }

        // Match by group name in targets
        for (const target of limit.targets) {
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

      if (!limitToDelete) {
        return `Error: Could not find a limit matching "${identifier}". Available limits: ${existingLimits.map(l => l.name || 'Unnamed').join(', ')}`;
      }

      // Remove the limit
      const updatedLimits = existingLimits.filter(l => l.id !== limitToDelete.id);
      await setDoc(userDocRef, { limits: updatedLimits }, { merge: true });
      // Sync to chrome.storage for content script access
      await syncLimitsToStorage(user.uid);

      const limitName = limitToDelete.name || 'limit';
      return `Successfully deleted ${limitName}`;
    } catch (error) {
      console.error('Error deleting limit:', error);
      return `Error deleting limit: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  };

  // Tool execution: Create Limit
  const executeCreateLimit = async (
    name: string | undefined,
    targets: Array<{ type: 'url' | 'group'; value: string }>,
    limitType: 'hard' | 'soft' | 'session',
    timeLimit: number | undefined,
    plusOnes: number | undefined,
    plusOneDuration: number | undefined
  ): Promise<string> => {
    console.log('executeCreateLimit called with:', { name, targets, limitType, timeLimit, plusOnes, plusOneDuration });

    if (!user?.uid) {
      return 'Error: User not authenticated';
    }

    try {
      // Fetch existing groups and limits
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        return 'Error: User document not found';
      }

      const existingLimits: Limit[] = userDoc.data().limits || [];
      const groups: Group[] = userDoc.data().groups || [];

      console.log('Available groups:', groups.map(g => ({ id: g.id, name: g.name })));

      // Process targets
      const limitTargets: LimitTarget[] = [];

      for (const target of targets) {
        console.log('Processing target:', target);

        if (target.type === 'url') {
          const prepared = target.value.startsWith('http') ? target.value : `https://${target.value}`;
          const normalizedUrl = normalizeUrl(prepared);
          limitTargets.push({ type: 'url', id: normalizedUrl });
          console.log('Added URL target:', normalizedUrl);
        } else {
          // Find group by name
          const group = groups.find(g => g.name.toLowerCase() === target.value.toLowerCase());
          console.log(`Looking for group "${target.value}", found:`, group);

          if (!group) {
            const availableGroups = groups.map(g => g.name).join(', ');
            return `Error: Group "${target.value}" not found. Available groups: ${availableGroups || 'none'}`;
          }
          limitTargets.push({ type: 'group', id: group.id });
          console.log('Added group target:', group.name);
        }
      }

      if (limitTargets.length === 0) {
        return 'Error: No valid targets specified';
      }

      // Create new limit
      const newLimit: Limit = {
        id: `limit:${Date.now()}`,
        type: limitType,
        targets: limitTargets,
        timeLimit: timeLimit || 0,
        createdAt: new Date().toISOString(),
      };

      if (name) {
        newLimit.name = name;
      }

      if (limitType === 'soft' && plusOnes !== undefined && plusOneDuration !== undefined) {
        newLimit.plusOnes = plusOnes;
        newLimit.plusOneDuration = plusOneDuration;
      }

      console.log('Creating limit:', newLimit);

      // Save to Firestore
      const updatedLimits = [...existingLimits, newLimit];
      await setDoc(userDocRef, { limits: updatedLimits }, { merge: true });
      // Sync to chrome.storage for content script access
      await syncLimitsToStorage(user.uid);

      const targetNames = targets.map(t => t.value).join(', ');
      const limitDetails = limitType === 'session'
        ? 'session-based (prompts on visit)'
        : limitType === 'soft'
        ? `${timeLimit} minutes with ${plusOnes} extensions of ${plusOneDuration}s each`
        : `${timeLimit} minutes (hard block)`;

      return `Successfully created ${limitType} limit${name ? ` "${name}"` : ''} on: ${targetNames}. Limit: ${limitDetails}`;
    } catch (error) {
      console.error('Error creating limit:', error);
      return `Error creating limit: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    if (!apiKey || apiKey === 'sk-your-api-key') {
      setError('OpenAI API key not configured. Please set VITE_OPENAI_API_KEY in your .env file.');
      return;
    }

    const userMessageContent = input.trim();
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
    let conversationMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    try {
      const openai = new OpenAI({
        apiKey: apiKey,
        dangerouslyAllowBrowser: true // Note: In production, API calls should go through a backend
      });

      conversationMessages = [
        {
          role: 'system',
          content: `You are a proactive assistant that helps users manage website groups and time limits. BE DECISIVE AND TAKE ACTION - don't ask unnecessary questions or ask for confirmation unless something is truly ambiguous.

You have access to these tools:
1. get_groups_and_limits: View all existing groups and limits
2. create_group: Creates a collection of websites (e.g., "Social Media" group with youtube.com, instagram.com, etc.)
3. update_group: Modifies an existing group (rename, add URLs, remove URLs)
4. delete_group: Deletes a group entirely
5. create_limit: Sets time restrictions on websites or groups
6. update_limit: Modifies an existing limit (change type, time, extensions, add/remove spare URLs)
   - Can add/remove individual URLs to a limit (spare URLs), but CANNOT change which groups are in the limit
   - "hard": Strict blocking when time runs out
   - "soft": Allows extensions/plus-ones after time expires
   - "session": Prompts user to set time limit when visiting the site
7. delete_limit: Deletes a limit entirely

IMPORTANT GUIDELINES:
- BE PROACTIVE: Don't ask for unnecessary confirmation. The only question you may have to ask frequenty is whether they want their limit to be a hard or soft limit, if they don't specify. Also clarify that a hard limit means they will not be able to access the site after their time for the rest of the day, while a soft limit allows extensions of their limit. Also note that they can choose a "session" limit, which will prompt them for how much time they want to spend every time they visit the site, instead of setting the number beforehand.
- CHAIN TOOLS: When appropriate, make multiple tool calls in sequence. For example, if a user says "create a social media group and limit it to 60 minutes", call BOTH create_group AND create_limit
- CHECK FIRST: Before creating duplicates, use get_groups_and_limits to see what exists
- UPDATE, DON'T RECREATE: If a user asks to change an existing group or limit, use update_group or update_limit instead of creating new ones
- SPARE URLS IN LIMITS: When a user asks to add an individual URL to an existing limit, use update_limit with addUrls parameter - don't create a new limit
- USE DEFAULTS: If details are missing, use sensible defaults:
  - Hard limits default to 60 minutes
  - Soft limits default to 60 minutes with 3 extensions of 300 seconds (5 minutes) each
  - Include common sites for well-known categories (e.g., Social Media = instagram, twitter, tiktok, facebook, etc.)
- URLS: Use only domain names without https:// or www. (e.g., "youtube.com" not "https://www.youtube.com")
- ERR ON THE SIDE OF CREATING GROUPS: If they ask you to "create a hard limit across all social media", it would be best to create a social media group, and then to create a limit using that group. This would be as opposed to creating a limit with spare urls.
`
        },
        // Build conversation from stored OpenAI messages
        ...messages
          .filter(m => m.openAiMessage) // Only include messages with proper OpenAI format
          .map(m => m.openAiMessage!),
        { role: 'user', content: userMessageContent }
      ];

      // First API call - may return tool calls
      const initialResponse = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: conversationMessages,
        tools: tools,
        tool_choice: 'auto',
        temperature: 0.7,
      });

      const responseMessage = initialResponse.choices[0]?.message;

      if (!responseMessage) {
        throw new Error('No response from API');
      }

      // Loop to handle multiple rounds of tool calls (for chain-of-thought)
      let currentResponse = responseMessage;
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

            if (toolCall.function.name === 'get_groups_and_limits') {
              toolResult = await executeGetGroupsAndLimits();
            } else if (toolCall.function.name === 'create_group') {
              toolResult = await executeCreateGroup(args.name, args.urls);
            } else if (toolCall.function.name === 'update_group') {
              toolResult = await executeUpdateGroup(
                args.identifier,
                args.name,
                args.addUrls,
                args.removeUrls
              );
            } else if (toolCall.function.name === 'create_limit') {
              toolResult = await executeCreateLimit(
                args.name,
                args.targets,
                args.limitType,
                args.timeLimit,
                args.plusOnes,
                args.plusOneDuration
              );
            } else if (toolCall.function.name === 'update_limit') {
              toolResult = await executeUpdateLimit(
                args.identifier,
                args.limitType,
                args.timeLimit,
                args.plusOnes,
                args.plusOneDuration,
                args.addUrls,
                args.removeUrls
              );
            } else if (toolCall.function.name === 'delete_group') {
              toolResult = await executeDeleteGroup(args.identifier);
            } else if (toolCall.function.name === 'delete_limit') {
              toolResult = await executeDeleteLimit(args.identifier);
            } else {
              toolResult = `Error: Unknown tool ${toolCall.function.name}`;
            }

            // Dispatch event to refresh Groups/Limits tabs if the tool call was successful
            if (!toolResult.startsWith('Error:')) {
              const dataModifyingTools = ['create_group', 'update_group', 'delete_group', 'create_limit', 'update_limit', 'delete_limit'];
              if (dataModifyingTools.includes(toolCall.function.name)) {
                console.log(`Dispatching groupsOrLimitsUpdated event for tool: ${toolCall.function.name}`);
                window.dispatchEvent(new CustomEvent('groupsOrLimitsUpdated'));
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
          const toolResultMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam = {
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
        const nextResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: conversationMessages,
          tools: tools,
          tool_choice: 'auto',
          temperature: 0.7,
        });

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
        // Need to stream from the last conversation state
        conversationMessages.push(currentResponse);

        const stream = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: conversationMessages,
          temperature: 0.7,
          stream: true
        });

        let fullContent = '';

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          fullContent += content;
          setStreamingContent(fullContent);
        }

        const assistantMessage: Message = {
          role: 'assistant',
          content: fullContent || 'Done.',
          openAiMessage: { role: 'assistant', content: fullContent || 'Done.' }
        };

        setMessages(prev => [...prev, assistantMessage]);
        setStreamingContent('');
      }

      if (false) {
        // No tool calls, stream the response directly
        const stream = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: conversationMessages,
          temperature: 0.7,
          stream: true
        });

        let fullContent = '';

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          fullContent += content;
          setStreamingContent(fullContent);
        }

        const assistantMessage: Message = {
          role: 'assistant',
          content: fullContent || 'No response received.'
        };

        setMessages(prev => [...prev, assistantMessage]);
        setStreamingContent('');
      }
    } catch (err) {
      console.error('OpenAI API error:', err);

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
        } else if (errorMsg.includes('api key') || errorMsg.includes('unauthorized') || errorMsg.includes('401')) {
          userFriendlyMessage = 'API key is invalid or missing. Please check your .env configuration.';
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
    toolCalls: Array<{ name: string; args: any; result: string }>;
  }> = ({ toolCalls }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
      <div className="mt-2 border-t border-gray-600 pt-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-300 transition-colors"
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
                className="bg-gray-900/50 border border-gray-600 rounded px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-purple-400 text-xs font-semibold">🔧</span>
                  <span className="text-purple-300 text-xs font-medium">{tool.name}</span>
                </div>
                {tool.args && (
                  <div className="text-xs text-gray-400 mb-1.5 font-mono bg-gray-900 rounded px-1.5 py-1 overflow-x-auto">
                    {JSON.stringify(tool.args, null, 2)}
                  </div>
                )}
                {tool.result && (
                  <div className="text-xs text-gray-300 bg-gray-900 rounded px-1.5 py-1">
                    <span className="text-gray-500">→ </span>
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
    <div className="flex flex-col h-full bg-gray-900 border-t border-gray-700">
      {/* Header */}
      <div className="px-4 py-2 border-b border-gray-700 bg-gray-800 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">AI Assistant</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={clearChat}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title="Clear chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
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
          <div className="text-center text-gray-500 text-sm mt-8">
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
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-100 border border-gray-700'
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
              {message.toolCalls && message.toolCalls.length > 0 && (
                <ToolCallsDisplay toolCalls={message.toolCalls} />
              )}
            </div>
          </div>
        ))}
        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-gray-800 text-gray-100 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <div className="whitespace-pre-wrap break-words">{streamingContent}</div>
              <span className="inline-block w-2 h-4 ml-1 bg-blue-500 animate-pulse" />
            </div>
          </div>
        )}
        {loading && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-gray-800 text-gray-100 border border-gray-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
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
      <div className="p-4 border-t border-gray-700 bg-gray-800">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            className="flex-1 bg-gray-900 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors self-end"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LLMPanel;
