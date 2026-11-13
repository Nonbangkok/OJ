// Reference solution: swap only when the pair is actually out of order. The
// guard is what makes the function idempotent — a second call finds the pair
// already sorted and does nothing.
//
// The swap goes through a temporary, because assigning second into first
// first would destroy the value the other side still needs.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
void CP::pair<T1, T2>::normalize()
{
  // Your code here
  if (second < first)
  {
    T1 hold = first;
    first = second;
    second = hold;
  }
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::sorted() const
{
  // You MAY need to edit this function
  return !(second < first);
}

#endif
