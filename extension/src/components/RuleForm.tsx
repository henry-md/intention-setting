import React, { useState, useEffect, useRef } from 'react';
import { Pencil } from 'lucide-react';
import type { Group } from '../types/Group';
import type { RuleTarget } from '../types/Rule';
import { normalizeUrl } from '../utils/urlNormalization';
import { checkTyposquatting } from '../utils/typosquatting';
import { prepareUrl } from '../utils/urlValidation';
import { expandTargetsToUrls, isUrlInTargets } from '../utils/ruleHelpers';
import { ItemListInput } from './ItemListInput';
import { GroupIcons } from './GroupIcons';
import { formatUrlForDisplay, getFaviconUrl, FAVICON_FALLBACK } from '../utils/urlDisplay';

interface RuleFormProps {
  ruleId?: string; // If provided, we're editing; if not, we're creating
  initialName?: string;
  initialTargetItems?: RuleTarget[];
  initialRuleType?: 'hard' | 'soft' | 'session';
  initialTimeLimit?: number;
  initialPlusOnes?: number;
  initialPlusOneDuration?: number;
  groups: Group[];
  onSave: (
    name: string,
    targetItems: RuleTarget[],
    ruleType: 'hard' | 'soft' | 'session',
    timeLimit: number,
    plusOnes?: number,
    plusOneDuration?: number
  ) => Promise<void>;
  onCancel: () => void;
  onEditGroup?: (groupId: string) => void;
}

/**
 * Shared form component for both creating and editing rules.
 * When ruleId is provided, we're in edit mode.
 * When ruleId is not provided, we're in create mode.
 */
export const RuleForm: React.FC<RuleFormProps> = ({
  ruleId,
  initialName = '',
  initialTargetItems = [],
  initialRuleType = 'hard',
  initialTimeLimit = 60,
  initialPlusOnes = 3,
  initialPlusOneDuration = 300,
  groups,
  onSave,
  onCancel,
  onEditGroup,
}) => {
  const [ruleName, setRuleName] = useState(initialName);
  const [targetInput, setTargetInput] = useState('');
  const [isRuleNameFocused, setIsRuleNameFocused] = useState(false);
  const [targetItems, setTargetItems] = useState<RuleTarget[]>(initialTargetItems);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [ruleType, setRuleType] = useState<'hard' | 'soft' | 'session'>(initialRuleType);
  const [timeLimit, setTimeLimit] = useState(initialTimeLimit.toString());
  const [plusOnes, setPlusOnes] = useState(initialPlusOnes.toString());
  const [plusOneMinutes, setPlusOneMinutes] = useState(Math.floor(initialPlusOneDuration / 60).toString());
  const [plusOneSeconds, setPlusOneSeconds] = useState((initialPlusOneDuration % 60).toString());
  const [formError, setFormError] = useState('');
  const [typosquattingWarning, setTyposquattingWarning] = useState<{
    url: string;
    suggestion: string;
    targetType: 'url' | 'group';
    targetId: string;
  } | null>(null);
  const ruleNameInputRef = useRef<HTMLInputElement>(null);

  const isEditMode = !!ruleId;

  // Update state when ruleId changes (switching to a different rule in edit mode)
  useEffect(() => {
    if (ruleId) {
      setRuleName(initialName);
      setTargetItems(initialTargetItems);
      setRuleType(initialRuleType);
      setTimeLimit(initialTimeLimit.toString());
      setPlusOnes(initialPlusOnes.toString());
      setPlusOneMinutes(Math.floor(initialPlusOneDuration / 60).toString());
      setPlusOneSeconds((initialPlusOneDuration % 60).toString());
    }
  }, [ruleId]);

  // Get matching group suggestions
  const getGroupSuggestions = () => {
    if (!targetInput.trim()) return [];

    const input = targetInput.toLowerCase();
    return groups.filter(group =>
      group.name.toLowerCase().includes(input)
    );
  };

  // Add normalized URL to target items list
  const addNormalizedUrlToList = async (url: string) => {
    const normalizedUrl = normalizeUrl(url);

    // Check if URL is already in targets (either directly or in a group)
    if (isUrlInTargets(normalizedUrl, targetItems, groups)) {
      setFormError('This URL is already in this rule');
      return;
    }

    // Add to targets list
    const newTargetItems: RuleTarget[] = [...targetItems, { type: 'url' as const, id: normalizedUrl }];

    setTargetItems(newTargetItems);
    setTargetInput('');
    setFormError('');
    setTyposquattingWarning(null);
  };

  // Add target from input to the list
  const handleAddTargetToList = async () => {
    if (!targetInput.trim()) return;

    const input = targetInput.trim();
    setFormError('');

    // Check if it's a group name
    const matchingGroup = groups.find(
      g => g.name.toLowerCase() === input.toLowerCase()
    );

    if (matchingGroup) {
      // Check if group is empty
      const groupUrls = expandTargetsToUrls([{ type: 'group', id: matchingGroup.id }], groups);

      if (groupUrls.length === 0) {
        setFormError('This group has no URLs');
        return;
      }

      // Check how many URLs from this group already exist in the rule
      const currentUrls = expandTargetsToUrls(targetItems, groups);
      const existingUrls = groupUrls.filter(url => currentUrls.includes(url));

      // Only prevent adding the group if ALL its URLs are already in the rule
      if (existingUrls.length === groupUrls.length) {
        setFormError('All URLs from this group are already in this rule');
        return;
      }

      // Add group to targets
      const newTargetItems: RuleTarget[] = [...targetItems, { type: 'group' as const, id: matchingGroup.id }];

      setTargetItems(newTargetItems);
      setTargetInput('');
      setFormError('');
      setShowSuggestions(false);
    } else {
      // It's a URL
      try {
        const preparedUrl = prepareUrl(input);

        // Check for typosquatting
        const typoCheck = checkTyposquatting(preparedUrl);
        if (typoCheck.isSuspicious && typoCheck.suggestion) {
          setTyposquattingWarning({
            url: preparedUrl,
            suggestion: typoCheck.suggestion + '.com',
            targetType: 'url',
            targetId: preparedUrl,
          });
          return;
        }

        // Add the URL
        await addNormalizedUrlToList(preparedUrl);
      } catch (error) {
        setFormError(error instanceof Error ? error.message : 'Invalid URL');
      }
    }
  };

  // Remove target from list
  const handleRemoveTargetFromList = (targetId: string) => {
    setTargetItems(targetItems.filter(t => t.id !== targetId));
  };

  // Get display name for a target
  const getTargetDisplayName = (targetId: string, targetType: 'url' | 'group'): string => {
    if (targetType === 'url') {
      return formatUrlForDisplay(targetId);
    } else {
      const group = groups.find(g => g.id === targetId);
      return group?.name || 'Unknown group';
    }
  };

  // Handle Tab key to auto-fill top suggestion
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab' && groupSuggestions.length > 0) {
      e.preventDefault();
      setTargetInput(groupSuggestions[0].name);
      setShowSuggestions(false);
      setFormError('');
    }
  };

  // Format seconds to always display as 2 digits
  const formatSecondsDisplay = (value: string): string => {
    return value.toString().padStart(2, '0');
  };

  // Validate and sanitize seconds input
  const handleSecondsInput = (inputValue: string): string => {
    const sanitized = inputValue.replace(/\D/g, ''); // Remove non-digits
    if (sanitized === '' || (parseInt(sanitized) >= 0 && parseInt(sanitized) <= 59)) {
      return sanitized;
    }
    return plusOneSeconds; // Return previous value if invalid
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (targetItems.length === 0) {
      setFormError('Please add at least one URL or group');
      return;
    }

    // For session rules, time limit is set when visiting the site
    // For hard/soft rules, validate time limit
    let timeLimitNum = 0;
    if (ruleType !== 'session') {
      timeLimitNum = parseInt(timeLimit);
      if (isNaN(timeLimitNum) || timeLimitNum <= 0) {
        setFormError('Please enter a valid time limit');
        return;
      }
    }

    // Calculate plus-one duration in seconds for soft rules
    let plusOneDurationSeconds: number | undefined;
    let plusOnesNum: number | undefined;
    if (ruleType === 'soft') {
      const minutes = parseInt(plusOneMinutes) || 0;
      const seconds = parseInt(plusOneSeconds) || 0;
      plusOneDurationSeconds = minutes * 60 + seconds;

      if (plusOneDurationSeconds <= 0) {
        setFormError('Plus-one duration must be greater than 0');
        return;
      }

      plusOnesNum = parseInt(plusOnes);
    }

    await onSave(ruleName.trim(), targetItems, ruleType, timeLimitNum, plusOnesNum, plusOneDurationSeconds);
  };

  const groupSuggestions = getGroupSuggestions();

  return (
    <div className="bg-zinc-800 border border-zinc-600 rounded-lg p-4 space-y-3">
      {/* Rule Name - Always an input, styled based on whether we have a name */}
      {isEditMode && ruleName ? (
        <div className={isRuleNameFocused ? 'flex w-full items-center gap-3' : 'inline-flex items-center gap-1.5'}>
          <input
            ref={ruleNameInputRef}
            type="text"
            value={ruleName}
            onChange={(e) => setRuleName(e.target.value)}
            onFocus={() => setIsRuleNameFocused(true)}
            onBlur={() => setIsRuleNameFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            className={`text-lg font-semibold bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-zinc-500 rounded px-2 py-1 min-w-0 text-white ${
              isRuleNameFocused ? 'flex-1 mr-1' : 'w-fit'
            }`}
            style={
              isRuleNameFocused
                ? undefined
                : { width: `${Math.max(1, Math.min(ruleName.length + 1, 28))}ch` }
            }
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (document.activeElement !== ruleNameInputRef.current) {
                ruleNameInputRef.current?.focus();
                return;
              }
              ruleNameInputRef.current?.blur();
            }}
            aria-label={isRuleNameFocused ? 'Save rule name' : 'Edit rule name'}
            title={isRuleNameFocused ? 'Save rule name' : 'Edit rule name'}
            className={`text-zinc-400 hover:text-white transition-colors ${isRuleNameFocused ? 'ml-auto pl-1' : ''}`}
          >
            <Pencil className={isRuleNameFocused ? 'h-4 w-4' : 'h-3 w-3'} />
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={ruleName}
          onChange={(e) => setRuleName(e.target.value)}
          placeholder="Rule name (optional)"
          className="w-full px-3 py-2 border border-zinc-600 bg-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-500 text-sm text-white placeholder-zinc-400"
        />
      )}

      {/* Target Input with List */}
      <div>
        <label className="block text-zinc-400 text-xs mb-1">URLs or Group Names</label>
        <div className="relative">
          <ItemListInput
            items={targetItems.map(t => t.id)}
            inputValue={targetInput}
            onInputChange={(value) => {
              setTargetInput(value);
              setShowSuggestions(true);
              setFormError('');
            }}
            onAddItem={handleAddTargetToList}
            onRemoveItem={handleRemoveTargetFromList}
            onKeyDown={handleInputKeyDown}
            placeholder={`e.g. youtube.com or ${groups.length > 0 ? groups[groups.length - 1].name : '[custom group]'}`}
            error={formError}
            renderItem={(itemId) => {
              const item = targetItems.find(t => t.id === itemId);
              if (!item) return null;

              const group = item.type === 'group' ? groups.find(g => g.id === item.id) : null;
              const isClickableGroup = item.type === 'group' && onEditGroup;

              return (
                <div
                  className={`flex items-center gap-2 py-2 px-3 bg-zinc-600 rounded-lg ${
                    isClickableGroup ? 'cursor-pointer hover:bg-zinc-500 transition-colors' : ''
                  }`}
                  onClick={() => {
                    if (isClickableGroup) {
                      onEditGroup(item.id);
                    }
                  }}
                >
                  {item.type === 'url' ? (
                    <img
                      src={getFaviconUrl(item.id)}
                      alt=""
                      className="w-4 h-4"
                      onError={(e) => {
                        e.currentTarget.src = FAVICON_FALLBACK;
                      }}
                    />
                  ) : group ? (
                    <GroupIcons group={group} iconSize="sm" maxIcons={3} />
                  ) : null}
                  <span className="flex-1 text-white text-sm">
                    {getTargetDisplayName(item.id, item.type)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTargetFromList(item.id);
                    }}
                    className="text-zinc-400 hover:text-white transition-colors"
                  >
                    <span className="text-xs">✕</span>
                  </button>
                </div>
              );
            }}
          />

          {/* Group Suggestions */}
          {showSuggestions && groupSuggestions.length > 0 && (
            <div className="absolute top-12 left-0 right-0 bg-zinc-800 border border-zinc-600 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
              <div className="px-3 py-1 text-xs text-zinc-400 border-b border-zinc-600">
                Matching Groups
              </div>
              {groupSuggestions.map(group => (
                <button
                  key={group.id}
                  onClick={() => {
                    // Check if group is empty
                    const groupUrls = expandTargetsToUrls([{ type: 'group', id: group.id }], groups);

                    if (groupUrls.length === 0) {
                      setFormError('This group has no URLs');
                      setShowSuggestions(false);
                      return;
                    }

                    // Check how many URLs from this group already exist in the rule
                    const currentUrls = expandTargetsToUrls(targetItems, groups);
                    const existingUrls = groupUrls.filter(url => currentUrls.includes(url));

                    // Only prevent adding the group if ALL its URLs are already in the rule
                    if (existingUrls.length === groupUrls.length) {
                      setFormError('All URLs from this group are already in this rule');
                      setShowSuggestions(false);
                      return;
                    }

                    // Add group to targets
                    setTargetItems([...targetItems, { type: 'group', id: group.id }]);
                    setTargetInput('');
                    setShowSuggestions(false);
                    setFormError('');
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-white hover:bg-zinc-700 flex items-center gap-2"
                >
                  <span className="font-medium">{group.name}</span>
                  <span className="text-xs text-zinc-400">({group.items.length} items)</span>
                </button>
              ))}
            </div>
          )}

          {/* Typosquatting Warning */}
          {typosquattingWarning && (
            <div className="mt-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 space-y-3">
              <div className="flex items-start gap-2">
                <span className="text-amber-400 text-xl">⚠️</span>
                <div className="flex-1">
                  <p className="text-amber-100 text-sm font-medium mb-1">
                    Possible typo detected
                  </p>
                  <p className="text-amber-200 text-xs">
                    Did you mean <span className="font-bold">{typosquattingWarning.suggestion}</span>?
                  </p>
                  <p className="text-amber-300 text-xs mt-1">
                    You entered: {formatUrlForDisplay(typosquattingWarning.url)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const correctedUrl = 'https://' + typosquattingWarning.suggestion;
                    await addNormalizedUrlToList(correctedUrl);
                  }}
                  className="flex-1 px-3 py-2 border border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/10 text-sm rounded-lg"
                >
                  Use {typosquattingWarning.suggestion}
                </button>
                <button
                  onClick={async () => {
                    await addNormalizedUrlToList(typosquattingWarning.url);
                  }}
                  className="flex-1 px-3 py-2 bg-zinc-600 hover:bg-zinc-700 text-white text-sm rounded-lg"
                >
                  Keep original
                </button>
                <button
                  onClick={() => {
                    setTyposquattingWarning(null);
                  }}
                  className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rule Type Selection */}
      <div>
        <label className="block text-zinc-400 text-xs mb-1">Rule Type</label>
        <div className="flex gap-2">
          <button
            onClick={() => setRuleType('hard')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm ${
              ruleType === 'hard'
                ? 'border border-red-500/50 bg-red-500/10 text-red-200'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            Hard
          </button>
          <button
            onClick={() => setRuleType('soft')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm ${
              ruleType === 'soft'
                ? 'border border-amber-500/50 bg-amber-500/12 text-amber-200'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            Soft
          </button>
          <button
            onClick={() => setRuleType('session')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm ${
              ruleType === 'session'
                ? 'border border-blue-500/50 bg-blue-500/12 text-blue-200'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            Session
          </button>
        </div>
      </div>

      {/* Time Limit (hidden for session rules) */}
      {ruleType !== 'session' && (
        <div>
          <label className="block text-zinc-400 text-xs mb-1">Time Limit (minutes)</label>
          <input
            type="number"
            value={timeLimit}
            onChange={(e) => setTimeLimit(e.target.value)}
            min="1"
            className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500"
          />
        </div>
      )}

      {/* Session rule explanation */}
      {ruleType === 'session' && (
        <div className="bg-zinc-900 border border-zinc-600 rounded-lg p-2">
          <p className="text-zinc-200 text-xs">
            Session rules prompt you to set a time limit when you visit the site
          </p>
        </div>
      )}

      {/* Plus Ones (for soft rules) */}
      {ruleType === 'soft' && (
        <div>
          <style dangerouslySetInnerHTML={{__html: `
            .no-spinner::-webkit-outer-spin-button,
            .no-spinner::-webkit-inner-spin-button {
              -webkit-appearance: none;
              margin: 0;
            }
            .no-spinner[type=number] {
              -moz-appearance: textfield;
              appearance: textfield;
            }
            .time-input:focus {
              background-color: rgba(113, 113, 122, 0.12);
              border-radius: 4px;
              outline: 1px solid rgba(113, 113, 122, 0.4);
              outline-offset: 1px;
            }
          `}} />

          <div className="flex items-start gap-2 text-sm">
            <span className="text-zinc-300 pt-1">Allow</span>

            {/* Number of plus ones */}
            <div className="flex flex-col items-center">
              <input
                type="number"
                value={plusOnes}
                onChange={(e) => setPlusOnes(e.target.value)}
                min="0"
                placeholder="3"
                className="no-spinner w-12 px-2 py-1 bg-zinc-700 border border-zinc-600 rounded text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-zinc-500"
                onWheel={(e) => e.currentTarget.blur()}
              />
              <span className="text-xs text-zinc-400 mt-1">Number</span>
            </div>

            <span className="text-zinc-300 pt-1">×</span>

            {/* Duration with built-in colon separator */}
            <div className="flex flex-col items-center">
              <div className="flex items-center bg-zinc-800 border border-zinc-600 rounded px-2 py-1 shadow-inner focus-within:ring-2 focus-within:ring-zinc-500 focus-within:border-zinc-500">
                <input
                  type="number"
                  value={plusOneMinutes}
                  onChange={(e) => setPlusOneMinutes(e.target.value)}
                  min="0"
                  placeholder="5"
                  className="time-input no-spinner bg-transparent text-white text-sm text-center focus:outline-none w-7"
                  onWheel={(e) => e.currentTarget.blur()}
                />
                <span className="text-zinc-400 text-sm font-semibold select-none">:</span>
                <input
                  type="text"
                  value={formatSecondsDisplay(plusOneSeconds)}
                  onChange={(e) => setPlusOneSeconds(handleSecondsInput(e.target.value))}
                  onBlur={(e) => {
                    // Ensure it's always 2 digits on blur
                    if (e.target.value && e.target.value.length === 1) {
                      setPlusOneSeconds(e.target.value.padStart(2, '0'));
                    }
                  }}
                  maxLength={2}
                  placeholder="00"
                  className="time-input no-spinner bg-transparent text-white text-sm text-center focus:outline-none w-7"
                />
              </div>
              <span className="text-xs text-zinc-400 mt-1">Duration</span>
            </div>

            <span className="text-zinc-300 pt-1">extensions</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          className="flex-1 rounded-lg border border-emerald-500/60 bg-emerald-500/12 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-500/18"
        >
          {isEditMode ? 'Save Changes' : 'Create Rule'}
        </button>
      </div>
    </div>
  );
};
