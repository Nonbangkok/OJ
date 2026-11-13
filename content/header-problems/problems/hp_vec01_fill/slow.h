// Deliberately naive reference: correct, but it re-walks the vector with an
// iterator for every element it writes, so one fill() costs Theta(n^2).
//
// meta.json sets "has_tle_subtask": false for this problem, so verify.py does
// NOT require this file to time out: fill is Theta(n) however you write it,
// and every implementation a student would plausibly submit is already
// linear. There is no honest "naive but correct" version that is a different
// complexity class, so the large subtask here buys scale (a million elements,
// three element types), not a complexity separation. The file exists because
// the eight-file contract asks for it, and it is kept correct — it really
// would time out on the large cases — so the problem could be promoted to a
// complexity problem by flipping that flag alone.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::fill(const T &value)
{
  for (size_t i = 0; i < mSize; i++)
  {
    iterator it = begin();
    for (size_t step = 0; step < i; step++)
    {
      ++it;
    }
    *it = value;
  }
}

#endif
