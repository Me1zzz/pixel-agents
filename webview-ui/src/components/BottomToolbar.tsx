import { useEffect, useRef, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import type { OfficeOption } from '../offices/officeTypes.js';
import { vscode } from '../vscodeApi.js';
import { Button } from './ui/Button.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';

interface BottomToolbarProps {
  activeOfficeId: string;
  officeOptions: OfficeOption[];
  onOfficeChange: (officeId: string) => void;
  isEditMode: boolean;
  onOpenClaude: () => void;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  workspaceFolders: WorkspaceFolder[];
}

export function BottomToolbar({
  activeOfficeId,
  officeOptions,
  onOfficeChange,
  isEditMode,
  onOpenClaude,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  workspaceFolders,
}: BottomToolbarProps) {
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [isBypassMenuOpen, setIsBypassMenuOpen] = useState(false);
  const [isOfficePickerOpen, setIsOfficePickerOpen] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);
  const officePickerRef = useRef<HTMLDivElement>(null);
  const pendingBypassRef = useRef(false);
  // Close folder picker / bypass menu on outside click
  useEffect(() => {
    if (!isFolderPickerOpen && !isBypassMenuOpen && !isOfficePickerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false);
        setIsBypassMenuOpen(false);
      }
      if (officePickerRef.current && !officePickerRef.current.contains(e.target as Node)) {
        setIsOfficePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isFolderPickerOpen, isBypassMenuOpen, isOfficePickerOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;
  const hasMultipleOffices = officeOptions.length > 1;
  const activeOffice =
    officeOptions.find((office) => office.officeId === activeOfficeId) ?? officeOptions[0];

  const handleAgentClick = () => {
    setIsBypassMenuOpen(false);
    pendingBypassRef.current = false;
    if (hasMultipleFolders) {
      setIsFolderPickerOpen((v) => !v);
    } else {
      onOpenClaude();
    }
  };

  const handleAgentHover = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(true);
    }
  };

  const handleAgentLeave = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(false);
    }
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    const bypassPermissions = pendingBypassRef.current;
    pendingBypassRef.current = false;
    vscode.postMessage({ type: 'openClaude', folderPath: folder.path, bypassPermissions });
  };

  const handleBypassSelect = (bypassPermissions: boolean) => {
    setIsBypassMenuOpen(false);
    if (hasMultipleFolders) {
      pendingBypassRef.current = bypassPermissions;
      setIsFolderPickerOpen(true);
    } else {
      vscode.postMessage({ type: 'openClaude', bypassPermissions });
    }
  };

  return (
    <div className="absolute bottom-10 left-10 z-20 flex items-center gap-4 pixel-panel p-4">
      <div ref={officePickerRef} className="relative">
        <Button
          variant={isOfficePickerOpen ? 'active' : 'default'}
          onClick={() => setIsOfficePickerOpen((prev) => !prev)}
          disabled={!hasMultipleOffices}
          title={hasMultipleOffices ? 'Select office' : 'Only Claude office is available'}
          className={!hasMultipleOffices ? 'opacity-[var(--btn-disabled-opacity)]' : ''}
        >
          {activeOffice?.label ?? 'Claude'}
        </Button>
        <Dropdown isOpen={isOfficePickerOpen} className="min-w-144">
          {officeOptions.map((office) => (
            <DropdownItem
              key={office.officeId}
              onClick={() => {
                setIsOfficePickerOpen(false);
                onOfficeChange(office.officeId);
              }}
              className={`text-base ${office.officeId === activeOfficeId ? 'bg-btn-bg' : ''}`}
            >
              {office.label}
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
      <div
        ref={folderPickerRef}
        className="relative"
        onMouseEnter={handleAgentHover}
        onMouseLeave={handleAgentLeave}
      >
        <Button
          variant="accent"
          onClick={handleAgentClick}
          className={
            isFolderPickerOpen || isBypassMenuOpen
              ? 'bg-accent-bright'
              : 'bg-accent hover:bg-accent-bright'
          }
        >
          + Agent
        </Button>
        <Dropdown isOpen={isBypassMenuOpen}>
          <DropdownItem onClick={() => handleBypassSelect(true)}>
            Skip permissions mode <span className="text-2xs text-warning">⚠</span>
          </DropdownItem>
        </Dropdown>
        <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
          {workspaceFolders.map((folder) => (
            <DropdownItem
              key={folder.path}
              onClick={() => handleFolderSelect(folder)}
              className="text-base"
            >
              {folder.name}
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
      <Button
        variant={isEditMode ? 'active' : 'default'}
        onClick={onToggleEditMode}
        title="Edit office layout"
      >
        Layout
      </Button>
      <Button
        variant={isSettingsOpen ? 'active' : 'default'}
        onClick={onToggleSettings}
        title="Settings"
      >
        Settings
      </Button>
    </div>
  );
}
