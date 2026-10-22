import React, { useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  AlertTriangle,
  Tag,
  Power,
  Shield,
} from 'lucide-react';
import {
  CategoryDefinition,
  AVAILABLE_CATEGORY_ICONS,
  PRESET_CATEGORY_COLORS,
  resolveCategoryIcon,
} from '../utils/categories';
import { ProcessedTransaction } from '../types';

interface CategoriesViewProps {
  categories: CategoryDefinition[];
  transactions: ProcessedTransaction[];
  onSaveCategory: (category: CategoryDefinition) => Promise<void>;
  onRenameCategory: (oldName: string, updatedCategory: CategoryDefinition) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onReassignCategory: (
    oldCategory: string,
    newCategory: string,
    categoryIdToDelete?: string
  ) => Promise<void>;
}

export const CategoriesView: React.FC<CategoriesViewProps> = ({
  categories,
  transactions,
  onSaveCategory,
  onRenameCategory,
  onDeleteCategory,
  onReassignCategory,
}) => {
  // Compute transaction counts per category
  const txCounts: Record<string, number> = {};
  for (const t of transactions) {
    txCounts[t.category] = (txCounts[t.category] || 0) + 1;
  }

  // Expanded card state
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null);
  const [expandedMode, setExpandedMode] = useState<'edit' | 'delete' | null>(null);

  // Form input state
  const [nameInput, setNameInput] = useState('');
  const [colorInput, setColorInput] = useState(PRESET_CATEGORY_COLORS[0]);
  const [iconInput, setIconInput] = useState('Tag');
  const [examplesInput, setExamplesInput] = useState('');
  const [isActiveInput, setIsActiveInput] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reassign target state
  const [targetCategory, setTargetCategory] = useState<string>('');

  const handleToggleCreate = () => {
    if (expandedCatId === 'NEW') {
      setExpandedCatId(null);
      setExpandedMode(null);
      return;
    }
    setExpandedCatId('NEW');
    setExpandedMode('edit');
    setNameInput('');
    setColorInput(PRESET_CATEGORY_COLORS[Math.floor(Math.random() * PRESET_CATEGORY_COLORS.length)]);
    setIconInput('Tag');
    setExamplesInput('');
    setIsActiveInput(true);
    setErrorMsg(null);
  };

  const handleToggleEdit = (cat: CategoryDefinition) => {
    if (expandedCatId === cat.id && expandedMode === 'edit') {
      setExpandedCatId(null);
      setExpandedMode(null);
      return;
    }
    setExpandedCatId(cat.id);
    setExpandedMode('edit');
    setNameInput(cat.name);
    setColorInput(cat.color);
    setIconInput(cat.iconName || 'Tag');
    setExamplesInput(cat.examples || '');
    setIsActiveInput(cat.isActive);
    setErrorMsg(null);
  };

  const handleToggleDelete = (cat: CategoryDefinition) => {
    if (cat.isSystem) return;
    if (expandedCatId === cat.id && expandedMode === 'delete') {
      setExpandedCatId(null);
      setExpandedMode(null);
      return;
    }
    const availableTargets = categories.filter((c) => c.id !== cat.id && c.isActive);
    setTargetCategory(availableTargets[0]?.name || '');
    setExpandedCatId(cat.id);
    setExpandedMode('delete');
    setErrorMsg(null);
  };

  const handleCloseExpanded = () => {
    setExpandedCatId(null);
    setExpandedMode(null);
    setErrorMsg(null);
  };

  const handleSaveForm = async (e: React.FormEvent, existingCat?: CategoryDefinition) => {
    e.preventDefault();
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setErrorMsg('Category name cannot be empty.');
      return;
    }

    const isDuplicate = categories.some(
      (c) =>
        c.name.toLowerCase() === trimmedName.toLowerCase() &&
        (!existingCat || c.id !== existingCat.id)
    );
    if (isDuplicate) {
      setErrorMsg(`A category named "${trimmedName}" already exists.`);
      return;
    }

    try {
      if (existingCat) {
        const oldName = existingCat.name;
        const updated: CategoryDefinition = {
          ...existingCat,
          name: trimmedName,
          color: colorInput,
          iconName: iconInput,
          examples: examplesInput.trim(),
          isActive: isActiveInput,
          updatedAt: Date.now(),
        };

        if (oldName !== trimmedName) {
          await onRenameCategory(oldName, updated);
        } else {
          await onSaveCategory(updated);
        }
      } else {
        const newCat: CategoryDefinition = {
          id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: trimmedName,
          color: colorInput,
          iconName: iconInput,
          examples: examplesInput.trim(),
          isActive: true,
          createdAt: Date.now(),
        };
        await onSaveCategory(newCat);
      }
      handleCloseExpanded();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleToggleActive = async (cat: CategoryDefinition) => {
    try {
      const updated: CategoryDefinition = {
        ...cat,
        isActive: !cat.isActive,
        updatedAt: Date.now(),
      };
      await onSaveCategory(updated);
    } catch (err) {
      alert(`Error toggling category status: ${(err as Error).message}`);
    }
  };

  const handleConfirmDirectDelete = async (cat: CategoryDefinition) => {
    try {
      await onDeleteCategory(cat.id);
      handleCloseExpanded();
    } catch (err) {
      alert(`Error deleting category: ${(err as Error).message}`);
    }
  };

  const handleConfirmDisable = async (cat: CategoryDefinition) => {
    try {
      await handleToggleActive(cat);
      handleCloseExpanded();
    } catch (err) {
      alert(`Error disabling category: ${(err as Error).message}`);
    }
  };

  const handleConfirmReassignAndDelete = async (cat: CategoryDefinition) => {
    if (!targetCategory) return;
    try {
      await onReassignCategory(cat.name, targetCategory, cat.id);
      handleCloseExpanded();
    } catch (err) {
      alert(`Error reassigning category: ${(err as Error).message}`);
    }
  };

  return (
    <div className="view-container categories-view-container">
      {/* Action Bar */}
      <div className="cat-view-header">
        <button
          type="button"
          className={`btn-add-cat ${expandedCatId === 'NEW' ? 'btn-add-cat-active' : ''}`}
          onClick={handleToggleCreate}
        >
          {expandedCatId === 'NEW' ? <X size={16} /> : <Plus size={16} />}
          <span>{expandedCatId === 'NEW' ? 'Close Form' : 'New Category'}</span>
        </button>
      </div>

      {/* Categories Grid / List */}
      <div className="cat-cards-grid">
        {/* Inline Create New Category Card */}
        {expandedCatId === 'NEW' && (
          <div
            className="cat-item-card cat-card-expanded-active"
            style={{ borderLeftColor: colorInput, borderLeftWidth: '4px' }}
          >
            <div className="cat-inline-header">
              <div className="cat-inline-title-wrap">
                <Tag size={17} style={{ color: colorInput }} />
                <h4 className="cat-inline-title">New Category</h4>
              </div>
              <button
                type="button"
                className="cat-btn-close-inline"
                onClick={handleCloseExpanded}
                aria-label="Cancel"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={(e) => handleSaveForm(e)} className="cat-inline-form">
              {errorMsg && (
                <div className="alert-error-msg">
                  <AlertTriangle size={15} />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="cat-new-name">
                  Category Name
                </label>
                <input
                  id="cat-new-name"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Pet Care, Gym & Fitness..."
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Category Color</label>
                <div className="color-swatches-grid">
                  {PRESET_CATEGORY_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`color-swatch-btn ${colorInput === c ? 'color-swatch-selected' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setColorInput(c)}
                      aria-label={c}
                    >
                      {colorInput === c && <Check size={14} className="swatch-check" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Category Icon</label>
                <div className="icon-picker-grid">
                  {Object.keys(AVAILABLE_CATEGORY_ICONS).map((iconKey) => {
                    const IconComp = AVAILABLE_CATEGORY_ICONS[iconKey];
                    const isSelected = iconInput === iconKey;
                    return (
                      <button
                        key={iconKey}
                        type="button"
                        className={`icon-picker-btn ${isSelected ? 'icon-picker-selected' : ''}`}
                        style={{
                          borderColor: isSelected ? colorInput : undefined,
                          color: isSelected ? colorInput : undefined,
                          backgroundColor: isSelected ? `${colorInput}1a` : undefined,
                        }}
                        onClick={() => setIconInput(iconKey)}
                        title={iconKey}
                      >
                        <IconComp size={18} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="cat-new-examples">
                  AI Keywords & Examples
                </label>
                <textarea
                  id="cat-new-examples"
                  className="form-textarea"
                  rows={2}
                  placeholder="e.g. veterinario, cibo gatti, pet shop, animali domestici, arcaplanet"
                  value={examplesInput}
                  onChange={(e) => setExamplesInput(e.target.value)}
                />
                <span className="form-help-sub">
                  Keywords and merchants used by AI to classify transactions into this category.
                </span>
              </div>

              <div className="cat-inline-actions-row">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={handleCloseExpanded}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-confirm"
                  style={{ backgroundColor: colorInput }}
                >
                  Create Category
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Existing Category Cards */}
        {categories.map((cat) => {
          const count = txCounts[cat.name] || 0;
          const Icon = resolveCategoryIcon(cat.iconName);
          const isExpanded = expandedCatId === cat.id;

          return (
            <div
              key={cat.id}
              className={`cat-item-card ${!cat.isActive ? 'cat-card-inactive' : ''} ${
                isExpanded ? 'cat-card-expanded-active' : ''
              }`}
              style={{
                borderLeftColor: cat.color,
                borderLeftWidth: '4px',
              }}
            >
              <div className="cat-item-top">
                <div className="cat-item-identity">
                  <div
                    className="cat-item-icon-box"
                    style={{
                      backgroundColor: `${cat.color}1f`,
                      color: cat.color,
                      borderColor: `${cat.color}4d`,
                    }}
                  >
                    <Icon size={20} />
                  </div>

                  <div className="cat-item-title-wrap">
                    <div className="cat-item-title-row">
                      <h4 className="cat-item-name">{cat.name}</h4>
                      {cat.isSystem && (
                        <span className="badge-system-pill" title="Default System Category">
                          <Shield size={10} />
                          System
                        </span>
                      )}
                      {!cat.isActive && (
                        <button
                          type="button"
                          className="badge-inactive-pill badge-enable-tap"
                          onClick={() => handleToggleActive(cat)}
                          title="Click to re-enable this category"
                        >
                          Disabled (Tap to enable)
                        </button>
                      )}
                    </div>
                    <span className="cat-item-count font-mono">
                      {count} {count === 1 ? 'transaction' : 'transactions'}
                    </span>
                  </div>
                </div>

                <div className="cat-item-actions">
                  <button
                    type="button"
                    className={`cat-btn-action ${
                      isExpanded && expandedMode === 'edit' ? 'cat-btn-active' : ''
                    }`}
                    onClick={() => handleToggleEdit(cat)}
                    title="Edit category"
                  >
                    <Pencil size={15} />
                  </button>

                  {!cat.isSystem && (
                    <button
                      type="button"
                      className={`cat-btn-action cat-btn-delete ${
                        isExpanded && expandedMode === 'delete' ? 'cat-btn-active-delete' : ''
                      }`}
                      onClick={() => handleToggleDelete(cat)}
                      title="Delete category options"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>

              {/* Collapsed view: Examples preview */}
              {!isExpanded && cat.examples && (
                <div className="cat-item-examples">
                  <span className="cat-examples-label">AI Keywords:</span>
                  <p className="cat-examples-text">{cat.examples}</p>
                </div>
              )}

              {/* Inline Expansion: Edit Mode */}
              {isExpanded && expandedMode === 'edit' && (
                <div className="cat-inline-expand-container">
                  <div className="cat-inline-expand-divider" />
                  <form onSubmit={(e) => handleSaveForm(e, cat)} className="cat-inline-form">
                    {errorMsg && (
                      <div className="alert-error-msg">
                        <AlertTriangle size={15} />
                        <span>{errorMsg}</span>
                      </div>
                    )}

                    <div className="form-group">
                      <label className="form-label" htmlFor={`cat-name-${cat.id}`}>
                        Category Name
                      </label>
                      <input
                        id={`cat-name-${cat.id}`}
                        type="text"
                        className="form-input"
                        placeholder="e.g. Pet Care..."
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Category Color</label>
                      <div className="color-swatches-grid">
                        {PRESET_CATEGORY_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={`color-swatch-btn ${colorInput === c ? 'color-swatch-selected' : ''}`}
                            style={{ backgroundColor: c }}
                            onClick={() => setColorInput(c)}
                            aria-label={c}
                          >
                            {colorInput === c && <Check size={14} className="swatch-check" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Category Icon</label>
                      <div className="icon-picker-grid">
                        {Object.keys(AVAILABLE_CATEGORY_ICONS).map((iconKey) => {
                          const IconComp = AVAILABLE_CATEGORY_ICONS[iconKey];
                          const isSelected = iconInput === iconKey;
                          return (
                            <button
                              key={iconKey}
                              type="button"
                              className={`icon-picker-btn ${isSelected ? 'icon-picker-selected' : ''}`}
                              style={{
                                borderColor: isSelected ? colorInput : undefined,
                                color: isSelected ? colorInput : undefined,
                                backgroundColor: isSelected ? `${colorInput}1a` : undefined,
                              }}
                              onClick={() => setIconInput(iconKey)}
                              title={iconKey}
                            >
                              <IconComp size={18} />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor={`cat-examples-${cat.id}`}>
                        AI Keywords & Examples
                      </label>
                      <textarea
                        id={`cat-examples-${cat.id}`}
                        className="form-textarea"
                        rows={2}
                        placeholder="e.g. veterinario, cibo animali, pet shop"
                        value={examplesInput}
                        onChange={(e) => setExamplesInput(e.target.value)}
                      />
                      <span className="form-help-sub">
                        Keywords and merchants used by AI to classify transactions into this category.
                      </span>
                    </div>

                    {!cat.isSystem && !cat.isActive && (
                      <div className="form-group-checkbox">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={isActiveInput}
                            onChange={(e) => setIsActiveInput(e.target.checked)}
                          />
                          <span>Re-enable this category</span>
                        </label>
                      </div>
                    )}

                    <div className="cat-inline-actions-row">
                      <button
                        type="button"
                        className="btn-cancel"
                        onClick={handleCloseExpanded}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-confirm"
                        style={{ backgroundColor: colorInput }}
                      >
                        Save Changes
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Inline Expansion: Delete Mode */}
              {isExpanded && expandedMode === 'delete' && (
                <div className="cat-inline-expand-container">
                  <div className="cat-inline-expand-divider" />
                  {count === 0 ? (
                    <div className="cat-direct-delete-wrap">
                      <div className="cat-delete-warning-text">
                        <AlertTriangle size={18} className="text-danger flex-shrink-0" />
                        <span>
                          No transactions are using <strong>"{cat.name}"</strong>. Are you sure you want to permanently delete this category?
                        </span>
                      </div>
                      <div className="cat-inline-actions-row">
                        <button
                          type="button"
                          className="btn-cancel"
                          onClick={handleCloseExpanded}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-confirm-delete-direct"
                          onClick={() => handleConfirmDirectDelete(cat)}
                        >
                          <Trash2 size={14} />
                          <span>Delete Category</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="cat-inline-reassign-wrap">
                      <p className="reassign-desc">
                        There are <strong>{count} transactions</strong> currently assigned to <strong>"{cat.name}"</strong>.
                      </p>
                      <p className="reassign-sub">
                        To preserve your financial records, select how to proceed:
                      </p>

                      <div className="reassign-options-box">
                        {/* Option 1: Disable category */}
                        <div className="reassign-option-card">
                          <h4 className="option-title">Option 1: Disable category (Recommended)</h4>
                          <p className="option-desc">
                            Keeps all historical transactions untouched, but hides the category from future imports and suggestions.
                          </p>
                          <button
                            type="button"
                            className="btn-option-deactivate"
                            onClick={() => handleConfirmDisable(cat)}
                          >
                            <Power size={14} />
                            <span>Disable "{cat.name}"</span>
                          </button>
                        </div>

                        {/* Option 2: Reassign and delete */}
                        <div className="reassign-option-card">
                          <h4 className="option-title">Option 2: Reassign and delete</h4>
                          <p className="option-desc">
                            Move all {count} transactions to another category, then delete "{cat.name}".
                          </p>
                          <div className="reassign-select-row">
                            <label className="text-xs text-muted">Destination category:</label>
                            <select
                              className="form-select"
                              value={targetCategory}
                              onChange={(e) => setTargetCategory(e.target.value)}
                            >
                              {categories
                                .filter((c) => c.id !== cat.id && c.isActive)
                                .map((c) => (
                                  <option key={c.id} value={c.name}>
                                    {c.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            className="btn-option-reassign-delete"
                            disabled={!targetCategory}
                            onClick={() => handleConfirmReassignAndDelete(cat)}
                          >
                            <Trash2 size={14} />
                            <span>Reassign all to {targetCategory} & Delete</span>
                          </button>
                        </div>
                      </div>

                      <div className="cat-inline-actions-row mt-3">
                        <button
                          type="button"
                          className="btn-cancel"
                          onClick={handleCloseExpanded}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
