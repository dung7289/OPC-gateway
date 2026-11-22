import { create } from 'zustand';

const useStore = create((set) => ({
  tagValues: {},
  wsConnected: false,

  setTagValue: (tagId, data) =>
    set((state) => ({
      tagValues: {
        ...state.tagValues,
        [tagId]: data,
      },
    })),

  setWsConnected: (connected) => set({ wsConnected: connected }),
}));

export default useStore;
