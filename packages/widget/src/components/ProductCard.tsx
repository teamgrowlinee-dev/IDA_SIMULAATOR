import React from "react";
import type { ProductCard as ProductCardType } from "../types";

interface Props {
  card: ProductCardType;
  loading: boolean;
  onAdd: (card: ProductCardType) => void;
  onViewInSimulator: (card: ProductCardType) => void;
}

export const ProductCard: React.FC<Props> = ({ card, loading, onAdd, onViewInSimulator }) => {
  return (
    <div className="gl-card">
      {card.image ? (
        <img src={card.image} alt={card.title} className="gl-card-img" loading="lazy" />
      ) : null}
      <div className="gl-card-body">
        <strong className="gl-card-title">{card.title}</strong>
        <div className="gl-card-price">
          <span>{card.price}</span>
          {card.compareAtPrice ? (
            <span className="gl-card-compare">{card.compareAtPrice}</span>
          ) : null}
        </div>
        {card.reason ? <p className="gl-card-reason">{card.reason}</p> : null}
        <div className="gl-card-actions">
          <button
            className="gl-card-add"
            disabled={loading}
            onClick={() => onAdd(card)}
            aria-label={`Lisa ${card.title} ostukorvi`}
          >
            {loading ? "Lisan..." : "Lisa ostukorvi"}
          </button>
          <button
            className="gl-card-sim"
            type="button"
            onClick={() => onViewInSimulator(card)}
            aria-label={`Vaata ${card.title} simulaatoris`}
          >
            Vaata simulaatoris
          </button>
        </div>
      </div>
    </div>
  );
};
