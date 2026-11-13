// Reference solution: a rotate is not performed, it is REMEMBERED.
//
// The representation. aux carries two numbers at once,
//
//     aux = block * 65536 + shift,     0 <= shift < block <= 30000
//
// and means: the top `block` slots of mData are to be read as a ring that is
// rotated by `shift`. Logical position i of that block (i = 0 is its deepest
// element) is the physical slot
//
//     mData[mSize - block + ((i + shift) % block)]
//
// so the whole stack's top is logical position block - 1. block <= 1 means
// there is nothing deferred and the stack is plain.
//
// Why it is fast. rotate(k) on the SAME k as the pending block is one
// subtraction of shift — O(1), however large k is. Reading the top is O(1)
// too: it is one modulo. The deferred work is only paid when the block has
// to change shape, which is where every FLUSH below comes from: a rotate
// with a different k, a push (which moves the top of the stack) or a pop
// (which would leave a hole inside the ring). A flush rotates the block for
// real with the three-reversal trick: O(block) time, no extra memory.
//
// So a run of m rotates with the same k costs O(k + m) instead of O(k * m),
// which is exactly the bound the statement asks for. The flush code is
// written out three times on purpose — the rules forbid adding a member
// function to the class, so there is nowhere to share it from.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::rotate(size_t k)
{
  // Your code here
  const size_t span = (k > mSize) ? mSize : k;
  size_t block = static_cast<size_t>(aux) / 65536;
  size_t shift = static_cast<size_t>(aux) % 65536;
  if (span <= 1)
    return; // nothing to rotate, and whatever is pending stays valid

  if (block >= 2 && block != span)
  {
    // FLUSH: rotate mData[base .. base + block) left by shift for real.
    const size_t base = mSize - block;
    for (size_t i = base, j = base + shift; i + 1 < j; i++, j--)
    {
      T hold = mData[i];
      mData[i] = mData[j - 1];
      mData[j - 1] = hold;
    }
    for (size_t i = base + shift, j = base + block; i + 1 < j; i++, j--)
    {
      T hold = mData[i];
      mData[i] = mData[j - 1];
      mData[j - 1] = hold;
    }
    for (size_t i = base, j = base + block; i + 1 < j; i++, j--)
    {
      T hold = mData[i];
      mData[i] = mData[j - 1];
      mData[j - 1] = hold;
    }
    block = 0;
    shift = 0;
  }

  if (block != span)
    shift = 0; // a fresh block
  shift = (shift + span - 1) % span;
  aux = static_cast<int>(span * 65536 + shift);
}

template <typename T>
const T &CP::stack<T>::top() const
{
  // You MAY need to edit this function
  const size_t block = static_cast<size_t>(aux) / 65536;
  const size_t shift = static_cast<size_t>(aux) % 65536;
  if (block < 2)
    return mData[mSize - 1];
  return mData[mSize - block + ((block - 1 + shift) % block)];
}

template <typename T>
void CP::stack<T>::push(const T &element)
{
  // You MAY need to edit this function
  const T value = element;
  const size_t block = static_cast<size_t>(aux) / 65536;
  const size_t shift = static_cast<size_t>(aux) % 65536;
  if (block >= 2)
  {
    // FLUSH before the top of the stack moves.
    const size_t base = mSize - block;
    for (size_t i = base, j = base + shift; i + 1 < j; i++, j--)
    {
      T hold = mData[i];
      mData[i] = mData[j - 1];
      mData[j - 1] = hold;
    }
    for (size_t i = base + shift, j = base + block; i + 1 < j; i++, j--)
    {
      T hold = mData[i];
      mData[i] = mData[j - 1];
      mData[j - 1] = hold;
    }
    for (size_t i = base, j = base + block; i + 1 < j; i++, j--)
    {
      T hold = mData[i];
      mData[i] = mData[j - 1];
      mData[j - 1] = hold;
    }
    aux = 0;
  }
  ensureCapacity(mSize + 1);
  mData[mSize] = value;
  mSize++;
}

template <typename T>
void CP::stack<T>::pop()
{
  // You MAY need to edit this function
  if (mSize == 0)
    return;
  const size_t block = static_cast<size_t>(aux) / 65536;
  const size_t shift = static_cast<size_t>(aux) % 65536;
  if (block >= 2)
  {
    // FLUSH: removing the logical top would otherwise punch a hole in the
    // middle of the ring.
    const size_t base = mSize - block;
    for (size_t i = base, j = base + shift; i + 1 < j; i++, j--)
    {
      T hold = mData[i];
      mData[i] = mData[j - 1];
      mData[j - 1] = hold;
    }
    for (size_t i = base + shift, j = base + block; i + 1 < j; i++, j--)
    {
      T hold = mData[i];
      mData[i] = mData[j - 1];
      mData[j - 1] = hold;
    }
    for (size_t i = base, j = base + block; i + 1 < j; i++, j--)
    {
      T hold = mData[i];
      mData[i] = mData[j - 1];
      mData[j - 1] = hold;
    }
    aux = 0;
  }
  mSize--;
}

#endif
