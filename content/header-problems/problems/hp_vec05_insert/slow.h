// Deliberately naive reference: CORRECT, and only one token different from
// the reference — it calls expand(mSize + 1) instead of ensureCapacity(mSize
// + 1), i.e. it asks for exactly one more slot every time.
//
// expand() always allocates and copies, so every single insert becomes
// Theta(n): a run of q appends costs Theta(q^2) instead of Theta(q). This is
// the single most common way to get this function wrong, and it is invisible
// on small inputs — which is exactly why the last subtask appends a million
// elements. verify.py requires this file to pass cases 1-5 and to time out on
// case 6, proving the big cases really do separate amortized doubling from
// one-slot-at-a-time growth.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::insert(size_t pos, const T &value)
{
  if (pos > mSize)
  {
    return;
  }
  T hold = value;
  expand(mSize + 1);
  for (size_t i = mSize; i > pos; i--)
  {
    mData[i] = mData[i - 1];
  }
  mData[pos] = hold;
  mSize++;
}

#endif
