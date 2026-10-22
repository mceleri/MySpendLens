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

  // Edit / Create modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryDefinition | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [colorInput, setColorInput] = useState(PRESET_CATEGORY_COLORS[0]);
  const [iconInput, setIconInput] = useState('Tag');
  const [examplesInput, setExamplesInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reassign / Delete modal state
  const [reassignModalCat, setReassignModalCat] = useState<CategoryDefinition | null>(null);
  const [targetCategory, setTargetCategory] = useState<string>('');

  const openCreateModal = () => {
    setEditingCategory(null);
    setNameInput('');
    setColorInput(PRESET_CATEGORY_COLORS[Math.floor(Math.random() * PRESET_CATEGORY_COLORS.length)]);
    setIconInput('Tag');
    setExamplesInput('');
    setErrorMsg(null);
    setIsModalOpen(true);
  };

  const openEditModal = (cat: CategoryDefinition) => {
    setEditingCategory(cat);
    setNameInput(cat.name);
    setColorInput(cat.color);
    setIconInput(cat.iconName || 'Tag');
    setExamplesInput(cat.examples || '');
    setErrorMsg(null);
    setIsModalOpen(true);
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setErrorMsg('Category name cannot be empty.');
      return;
    }

    // Check duplicate name
    const isDuplicate = categories.some(
      (c) =>
        c.name.toLowerCase() === trimmedName.toLowerCase() &&
        (!editingCategory || c.id !== editingCategory.id)
    );
    if (isDuplicate) {
      setErrorMsg(`A category named "${trimmedName}" already exists.`);
      return;
    }

    try {
      if (editingCategory) {
        // Renaming or updating existing
        const oldName = editingCategory.name;
        const updated: CategoryDefinition = {
          ...editingCategory,
          name: trimmedName,
          color: colorInput,
          iconName: iconInput,
          examples: examplesInput.trim(),
          updatedAt: Date.now(),
        };

        if (oldName !== trimmedName) {
          await onRenameCategory(oldName, updated);
        } else {
          await onSaveCategory(updated);
        }
      } else {
        // Creating new category
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
      setIsModalOpen(false);
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

  const handleDeleteClick = async (cat: CategoryDefinition) => {
    if (cat.isSystem) {
      alert('System categories cannot be deleted.');
      return;
    }

    const count = txCounts[cat.name] || 0;
    if (count === 0) {
      if (window.confirm(`Delete category "${cat.name}"? This cannot be undone.`)) {
        await onDeleteCategory(cat.id);
      }
    } else {
      // Has active transactions -> open Reassignment / Deactivation modal
      const availableTargets = categories.filter((c) => c.id !== cat.id && c.isActive);
      setTargetCategory(availableTargets[0]?.name || '');
      setReassignModalCat(cat);
    }
  };

  const handleConfirmReassignAndDelete = async () => {
    if (!reassignModalCat || !targetCategory) return;
    try {
      await onReassignCategory(reassignModalCat.name, targetCategory, reassignModalCat.id);
      setReassignModalCat(null);
    } catch (err) {
      alert(`Error reassigning category: ${(err as Error).message}`);
    }
  };

  const handleDeactivateInstead = async () => {
    if (!reassignModalCat) return;
    try {
      await handleToggleActive(reassignModalCat);
      setReassignModalCat(null);
    } catch (err) {
      alert(`Error deactivating category: ${(err as Error).message}`);
    }
  };

  return (
    <div className="view-container categories-view-container">
      {/* Action Bar */}
      <div className="cat-view-header">
        <button
          type="button"
          className="btn-add-cat"
          onClick={openCreateModal}
        >
          <Plus size={16} />
          <span>New Category</span>
        </button>
      </div>

      {/* Categories Grid / List */}
      <div className="cat-cards-grid">
        {categories.map((cat) => {
          const count = txCounts[cat.name] || 0;
          const Icon = resolveCategoryIcon(cat.iconName);

          return (
            <div
              key={cat.id}
              className={`cat-item-card ${!cat.isActive ? 'cat-card-inactive' : ''}`}
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
                        <span className="badge-inactive-pill">Disabled</span>
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
                    className="cat-btn-action"
                    onClick={() => openEditModal(cat)}
                    title="Edit category"
                  >
                    <Pencil size={15} />
                  </button>

                  <button
                    type="button"
                    className={`cat-btn-action ${cat.isActive ? 'text-success' : 'text-muted'}`}
                    onClick={() => handleToggleActive(cat)}
                    title={cat.isActive ? 'Disable category' : 'Enable category'}
                  >
                    <Power size={15} />
                  </button>

                  {!cat.isSystem && (
                    <button
                      type="button"
                      className="cat-btn-action cat-btn-delete"
                      onClick={() => handleDeleteClick(cat)}
                      title="Delete category"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>

              {cat.examples && (
                <div className="cat-item-examples">
                  <span className="cat-examples-label">AI Keywords:</span>
                  <p className="cat-examples-text">{cat.examples}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal: Create / Edit Category */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div
            className="modal-card cat-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title-wrap">
                <Tag size={18} className="text-primary" />
                <h3 className="modal-title">
                  {editingCategory ? 'Edit Category' : 'New Category'}
                </h3>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setIsModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="cat-form">
              {errorMsg && (
                <div className="alert-error-msg">
                  <AlertTriangle size={15} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Category Name */}
              <div className="form-group">
                <label className="form-label" htmlFor="cat-name-input">
                  Category Name
                </label>
                <input
                  id="cat-name-input"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Pet Care, Gym & Fitness..."
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {/* Color Swatches */}
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

              {/* Icon Picker */}
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

              {/* Keywords / Passages for Semantic AI Embeddings */}
              <div className="form-group">
                <div className="form-label-with-tip">
                  <label className="form-label" htmlFor="cat-examples-input">
                    AI Semantic Keywords & Examples
                  </label>
                  <span className="form-tip-text">Used by Tier 2 Embedding Engine</span>
                </div>
                <textarea
                  id="cat-examples-input"
                  className="form-textarea"
                  rows={3}
                  placeholder="e.g. veterinario, cibo gatti, pet shop, animali domestici, arcaplanet, crocchette"
                  value={examplesInput}
                  onChange={(e) => setExamplesInput(e.target.value)}
                />
                <span className="form-help-sub">
                  Separate merchants, words or descriptions by commas. The AI uses these vectors to automatically categorize new bank transactions.
                </span>
              </div>

              <div className="modal-actions-row">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-confirm"
                  style={{ backgroundColor: colorInput }}
                >
                  {editingCategory ? 'Save Changes' : 'Create Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reassign & Delete */}
      {reassignModalCat && (
        <div className="modal-overlay" onClick={() => setReassignModalCat(null)}>
          <div
            className="modal-card cat-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title-wrap text-danger">
                <AlertTriangle size={18} />
                <h3 className="modal-title">Delete "{reassignModalCat.name}"</h3>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setReassignModalCat(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="reassign-modal-content">
              <p className="reassign-desc">
                There are <strong>{txCounts[reassignModalCat.name] || 0} transactions</strong> currently assigned to <strong>"{reassignModalCat.name}"</strong>.
              </p>
              <p className="reassign-sub">
                To keep your financial data intact, choose how you would like to proceed:
              </p>

              <div className="reassign-options-box">
                {/* Option 1: Deactivate instead */}
                <div className="reassign-option-card">
                  <h4 className="option-title">Option 1: Disable category (Recommended)</h4>
                  <p className="option-desc">
                    Keeps all historical transactions untouched, but hides the category from new imports and future selections.
                  </p>
                  <button
                    type="button"
                    className="btn-option-deactivate"
                    onClick={handleDeactivateInstead}
                  >
                    <Power size={14} />
                    <span>Disable "{reassignModalCat.name}"</span>
                  </button>
                </div>

                {/* Option 2: Reassign & Delete */}
                <div className="reassign-option-card">
                  <h4 className="option-title">Option 2: Reassign movements and delete</h4>
                  <p className="option-desc">
                    Move all {txCounts[reassignModalCat.name] || 0} transactions into another active category, then delete "{reassignModalCat.name}".
                  </p>
                  <div className="reassign-select-row">
                    <label className="text-xs text-muted">Destination category:</label>
                    <select
                      className="form-select"
                      value={targetCategory}
                      onChange={(e) => setTargetCategory(e.target.value)}
                    >
                      {categories
                        .filter((c) => c.id !== reassignModalCat.id && c.isActive)
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
                    onClick={handleConfirmReassignAndDelete}
                  >
                    <Trash2 size={14} />
                    <span>Reassign all to {targetCategory} & Delete</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
