import React, { useState, useEffect } from 'react';
import type { Group } from '../types/Group';
import type { LimitTarget, LimitUrl } from '../types/Limit';
import { getNormalizedHostname, normalizeUrl } from '../utils/urlNormalization';
import { checkTyposquatting } from '../utils/typosquatting';
import { prepareUrl } from '../utils/urlValidation';
import { ItemListInput } from './ItemListInput';
import { GroupIcons } from './GroupIcons';

interface LimitFormProps {
  limitId?: string; // If provided, we're editing; if not, we're creating
  initialName?: string;
  initialTargetItems?: LimitTarget[];
  initialTargetUrls?: LimitUrl[];
  initialLimitType?: 'hard' | 'soft' | 'session';
  initialTimeLimit?: number;
  initialPlusOnes?: number;
  initialPlusOneDuration?: number;
  groups: Group[];
  onSave: (
    name: string,
    targetItems: LimitTarget[],
    targetUrls: LimitUrl[],
    limitType: 'hard' | 'soft' | 'session',
    timeLimit: number,
    plusOnes?: number,
    plusOneDuration?: number
  ) => Promise<void>;
  onCancel: () => void;
}

/**
 * Shared form component for both creating and editing limits.
 * When limitId is provided, we're in edit mode.
 * When limitId is not provided, we're in create mode.
 */
export const LimitForm: React.FC<LimitFormProps> = ({
  limitId,
  initialName = '',
  initialTargetItems = [],
  initialTargetUrls = [],
  initialLimitType = 'hard',
  initialTimeLimit = 60,
  initialPlusOnes = 3,
  initialPlusOneDuration = 300,
  groups,
  onSave,
  onCancel,
}) => {
  const [limitName, setLimitName] = useState(initialName);
  const [targetInput, setTargetInput] = useState('');
  const [targetItems, setTargetItems] = useState<LimitTarget[]>(initialTargetItems);
  const [targetUrls, setTargetUrls] = useState<LimitUrl[]>(initialTargetUrls);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [limitType, setLimitType] = useState<'hard' | 'soft' | 'session'>(initialLimitType);
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

  const isEditMode = !!limitId;

  // Update state when limitId changes (switching to a different limit in edit mode)
  useEffect(() => {
    if (limitId) {
      setLimitName(initialName);
      setTargetItems(initialTargetItems);
      setTargetUrls(initialTargetUrls);
      setLimitType(initialLimitType);
      setTimeLimit(initialTimeLimit.toString());
      setPlusOnes(initialPlusOnes.toString());
      setPlusOneMinutes(Math.floor(initialPlusOneDuration / 60).toString());
      setPlusOneSeconds((initialPlusOneDuration % 60).toString());
    }
  }, [limitId]);

  // Get URLs from a group (recursively if it contains other groups)
  const getGroupUrls = (group: Group): string[] => {
    const urls: string[] = [];

    for (const item of group.items) {
      if (item.startsWith('group:')) {
        const nestedGroup = groups.find(g => g.id === item);
        if (nestedGroup) {
          urls.push(...getGroupUrls(nestedGroup));
        }
      } else {
        urls.push(item);
      }
    }

    return urls;
  };

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

    // Check if URL is already in target URLs
    const existingUrl = targetUrls.find(u => u.url === normalizedUrl);
    if (existingUrl) {
      if (existingUrl.source === 'direct') {
        setFormError('This URL is already in this limit');
      } else {
        setFormError(`This URL is already in this limit (as part of ${existingUrl.source})`);
      }
      return;
    }

    // Add to both visual targets and URL list
    const newTargetItems: LimitTarget[] = [...targetItems, { type: 'url' as const, id: normalizedUrl }];
    const newTargetUrls: LimitUrl[] = [...targetUrls, { url: normalizedUrl, source: 'direct' }];

    setTargetItems(newTargetItems);
    setTargetUrls(newTargetUrls);
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
      // Get all URLs from the group
      const groupUrls = getGroupUrls(matchingGroup);

      if (groupUrls.length === 0) {
        setFormError('This group has no URLs');
        return;
      }

      // Check how many URLs from this group already exist in the limit
      const existingUrls = groupUrls.filter(url =>
        targetUrls.some(u => u.url === url)
      );

      // Only prevent adding the group if ALL its URLs are already in the limit
      if (existingUrls.length === groupUrls.length) {
        setFormError('All URLs from this group are already in this limit');
        return;
      }

      // Add URLs that don't already exist to the URL list (for validation)
      const newUrls: LimitUrl[] = groupUrls
        .filter(url => !targetUrls.some(u => u.url === url))
        .map(url => ({ url, source: matchingGroup.name }));

      // Add group to visual targets (for display)
      const newTargetItems: LimitTarget[] = [...targetItems, { type: 'group' as const, id: matchingGroup.id }];
      const newTargetUrls: LimitUrl[] = [...targetUrls, ...newUrls];

      setTargetItems(newTargetItems);
      setTargetUrls(newTargetUrls);
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
    const target = targetItems.find(t => t.id === targetId);
    if (!target) return;

    if (target.type === 'url') {
      // Remove URL from both lists
      setTargetItems(targetItems.filter(t => t.id !== targetId));
      setTargetUrls(targetUrls.filter(u => u.url !== targetId));
    } else {
      // Remove group from visual list
      setTargetItems(targetItems.filter(t => t.id !== targetId));

      // Remove all URLs from this group from the URL list
      const group = groups.find(g => g.id === targetId);
      if (group) {
        setTargetUrls(targetUrls.filter(u => u.source !== group.name));
      }
    }
  };

  // Get display name for a target
  const getTargetDisplayName = (targetId: string, targetType: 'url' | 'group'): string => {
    if (targetType === 'url') {
      return targetId.replace(/^https?:\/\//, '');
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

    // For session limits, time limit is set when visiting the site
    // For hard/soft limits, validate time limit
    let timeLimitNum = 0;
    if (limitType !== 'session') {
      timeLimitNum = parseInt(timeLimit);
      if (isNaN(timeLimitNum) || timeLimitNum <= 0) {
        setFormError('Please enter a valid time limit');
        return;
      }
    }

    // Calculate plus-one duration in seconds for soft limits
    let plusOneDurationSeconds: number | undefined;
    let plusOnesNum: number | undefined;
    if (limitType === 'soft') {
      const minutes = parseInt(plusOneMinutes) || 0;
      const seconds = parseInt(plusOneSeconds) || 0;
      plusOneDurationSeconds = minutes * 60 + seconds;

      if (plusOneDurationSeconds <= 0) {
        setFormError('Plus-one duration must be greater than 0');
        return;
      }

      plusOnesNum = parseInt(plusOnes);
    }

    await onSave(limitName.trim(), targetItems, targetUrls, limitType, timeLimitNum, plusOnesNum, plusOneDurationSeconds);
  };

  const groupSuggestions = getGroupSuggestions();

  return (
    <div className="bg-gray-800 border border-gray-600 rounded-lg p-4 space-y-3">
      {/* Limit Name - Always an input, styled based on whether we have a name */}
      {isEditMode && limitName ? (
        <input
          type="text"
          value={limitName}
          onChange={(e) => setLimitName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="text-lg font-semibold bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1 -mx-2 w-full text-white"
        />
      ) : (
        <input
          type="text"
          value={limitName}
          onChange={(e) => setLimitName(e.target.value)}
          placeholder="Limit name (optional)"
          className="w-full px-3 py-2 border border-gray-600 bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-white placeholder-gray-400"
        />
      )}

      {/* Target Input with List */}
      <div>
        <label className="block text-gray-400 text-xs mb-1">URLs or Group Names</label>
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

              return (
                <div className="flex items-center gap-2 py-2 px-3 bg-slate-600 rounded-lg">
                  {item.type === 'url' ? (
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${getNormalizedHostname(item.id)}&sz=32`}
                      alt=""
                      className="w-4 h-4"
                      onError={(e) => {
                        e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23666"/></svg>';
                      }}
                    />
                  ) : group ? (
                    <GroupIcons group={group} iconSize="sm" maxIcons={3} />
                  ) : null}
                  <span className="flex-1 text-white text-sm">
                    {getTargetDisplayName(item.id, item.type)}
                  </span>
                  <button
                    onClick={() => handleRemoveTargetFromList(item.id)}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <span className="text-xs">✕</span>
                  </button>
                </div>
              );
            }}
          />

          {/* Group Suggestions */}
          {showSuggestions && groupSuggestions.length > 0 && (
            <div className="absolute top-12 left-0 right-0 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
              <div className="px-3 py-1 text-xs text-gray-400 border-b border-gray-600">
                Matching Groups
              </div>
              {groupSuggestions.map(group => (
                <button
                  key={group.id}
                  onClick={() => {
                    setTargetInput(group.name);
                    setShowSuggestions(false);
                    setFormError('');
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center gap-2"
                >
                  <span className="font-medium">{group.name}</span>
                  <span className="text-xs text-gray-400">({group.items.length} items)</span>
                </button>
              ))}
            </div>
          )}

          {/* Typosquatting Warning */}
          {typosquattingWarning && (
            <div className="bg-yellow-900 border border-yellow-600 rounded-lg p-3 space-y-3 mt-2">
              <div className="flex items-start gap-2">
                <span className="text-yellow-500 text-xl">⚠️</span>
                <div className="flex-1">
                  <p className="text-yellow-100 text-sm font-medium mb-1">
                    Possible typo detected
                  </p>
                  <p className="text-yellow-200 text-xs">
                    Did you mean <span className="font-bold">{typosquattingWarning.suggestion}</span>?
                  </p>
                  <p className="text-yellow-300 text-xs mt-1">
                    You entered: {typosquattingWarning.url.replace(/^https?:\/\//, '')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const correctedUrl = 'https://' + typosquattingWarning.suggestion;
                    await addNormalizedUrlToList(correctedUrl);
                  }}
                  className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg"
                >
                  Use {typosquattingWarning.suggestion}
                </button>
                <button
                  onClick={async () => {
                    await addNormalizedUrlToList(typosquattingWarning.url);
                  }}
                  className="flex-1 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg"
                >
                  Keep original
                </button>
                <button
                  onClick={() => {
                    setTyposquattingWarning(null);
                  }}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Limit Type Selection */}
      <div>
        <label className="block text-gray-400 text-xs mb-1">Limit Type</label>
        <div className="flex gap-2">
          <button
            onClick={() => setLimitType('hard')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm ${
              limitType === 'hard'
                ? 'bg-red-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Hard
          </button>
          <button
            onClick={() => setLimitType('soft')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm ${
              limitType === 'soft'
                ? 'bg-yellow-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Soft
          </button>
          <button
            onClick={() => setLimitType('session')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm ${
              limitType === 'session'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Session
          </button>
        </div>
      </div>

      {/* Time Limit (hidden for session limits) */}
      {limitType !== 'session' && (
        <div>
          <label className="block text-gray-400 text-xs mb-1">Time Limit (minutes)</label>
          <input
            type="number"
            value={timeLimit}
            onChange={(e) => setTimeLimit(e.target.value)}
            min="1"
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Session limit explanation */}
      {limitType === 'session' && (
        <div className="bg-blue-900 border border-blue-600 rounded-lg p-2">
          <p className="text-blue-200 text-xs">
            Session limits prompt you to set a time limit when you visit the site
          </p>
        </div>
      )}

      {/* Plus Ones (for soft limits) */}
      {limitType === 'soft' && (
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
              background-color: rgba(59, 130, 246, 0.1);
              border-radius: 4px;
              outline: 1px solid rgba(59, 130, 246, 0.3);
              outline-offset: 1px;
            }
          `}} />

          <div className="flex items-start gap-2 text-sm">
            <span className="text-gray-300 pt-1">Allow</span>

            {/* Number of plus ones */}
            <div className="flex flex-col items-center">
              <input
                type="number"
                value={plusOnes}
                onChange={(e) => setPlusOnes(e.target.value)}
                min="0"
                placeholder="3"
                className="no-spinner w-12 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                onWheel={(e) => e.currentTarget.blur()}
              />
              <span className="text-xs text-gray-400 mt-1">Number</span>
            </div>

            <span className="text-gray-300 pt-1">×</span>

            {/* Duration with built-in colon separator */}
            <div className="flex flex-col items-center">
              <div className="flex items-center bg-gray-800 border border-gray-600 rounded px-2 py-1 shadow-inner focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
                <input
                  type="number"
                  value={plusOneMinutes}
                  onChange={(e) => setPlusOneMinutes(e.target.value)}
                  min="0"
                  placeholder="5"
                  className="time-input no-spinner bg-transparent text-white text-sm text-center focus:outline-none w-7"
                  onWheel={(e) => e.currentTarget.blur()}
                />
                <span className="text-gray-400 text-sm font-semibold select-none">:</span>
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
              <span className="text-xs text-gray-400 mt-1">Duration</span>
            </div>

            <span className="text-gray-300 pt-1">extensions</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm"
        >
          {isEditMode ? 'Save Changes' : 'Create Limit'}
        </button>
      </div>
    </div>
  );
};
